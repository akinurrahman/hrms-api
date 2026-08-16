import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { businessToday, toDateKey } from '../common/utils/date.js';
import { employeeEligibleOn } from '../common/utils/employee-eligibility.js';
import { HolidayService } from '../holiday/holiday.service.js';
import {
  AttendanceAuditService,
  AuditEntry,
} from './attendance-audit.service.js';
import {
  AttendanceDerivationService,
  DerivationSummary,
} from './attendance-derivation.service.js';
import { AttendanceLeaveService } from './attendance-leave.service.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import { AttendanceStatus } from './constants/attendance-enums.js';
import { AttendancePolicy } from './constants/attendance-policy.constant.js';
import {
  ClosableRow,
  CloseSkipReason,
  planCloseDay,
} from './utils/close-day.js';

/**
 * Employees per sweep.
 *
 * The roster pages because a human is reading it; the close job has to reach
 * every employee on rolls, so it walks instead. Five hundred keeps each
 * transaction's write count and each read's `in` list to something Neon returns
 * inside the 15-second budget, and it bounds memory regardless of headcount.
 */
const CLOSE_CHUNK_SIZE = 500;

/** The employee fields the sweep needs, loaded once per chunk. */
const EMPLOYEE_SELECT = {
  id: true,
  employeeId: true,
  shiftId: true,
} satisfies Prisma.EmployeeSelect;

type CloseEmployee = Prisma.EmployeeGetPayload<{
  select: typeof EMPLOYEE_SELECT;
}>;

export interface SkippedClose {
  /** The badge code, not the uuid — this list is read by a person. */
  employeeId: string;
  reason: CloseSkipReason;
}

export interface CloseSummary {
  date: string;
  employeesConsidered: number;
  /** The punch-derivation pass that runs first. See `close()` step 2. */
  derivation: DerivationSummary;
  created: { absent: number; onLeave: number; notApplicable: number };
  conflictsFlagged: number;
  missingCheckoutFixed: number;
  /** Days a row already answered, correctly and completely. */
  untouched: number;
  skipped: SkippedClose[];
}

/**
 * The nightly close: turns a day that has finished into a complete set of
 * attendance rows.
 *
 * Everything else in the module reacts to something — a punch arriving, HR
 * clicking save, a leave being approved. Nothing reacts to *nothing happening*,
 * and an absence is exactly that. Derivation refuses to invent a row for a
 * punchless day on purpose (see its class comment); this service is the party
 * that holds the holiday calendar, the weekly-off list and the leave register at
 * once, which is what makes it able to tell an absence from a Sunday.
 *
 * **Every row it creates is SYSTEM**, the lowest rank there is. That is the
 * whole safety argument: tonight's placeholder loses to any punch and to any
 * human, so a job that runs unattended at 11am can never destroy evidence.
 *
 * **Idempotent by construction, not by a guard.** After one run every eligible
 * employee-day has a row, and `planCloseDay` answers NOOP for every row-exists
 * branch whose change has already been made. A second run plans zero writes.
 */
@Injectable()
export class AttendanceCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AttendancePolicyService,
    private readonly holidayService: HolidayService,
    private readonly leaveService: AttendanceLeaveService,
    private readonly derivationService: AttendanceDerivationService,
    private readonly auditService: AttendanceAuditService,
  ) {}

  /**
   * @param actorId the user who triggered it, or `null` for the scheduler. Only
   * reaches the audit log, and only for changes to rows that already existed.
   */
  async close(input: {
    date: Date;
    actorId: string | null;
  }): Promise<CloseSummary> {
    const policy = await this.policyService.get();

    this.assertClosable(input.date, policy);

    // Punches first, gaps second. A device that synced after ingestion's inline
    // derive leaves punches sitting unprocessed; marking those days ABSENT and
    // waiting for somebody to notice and call /attendance/derive is not a
    // recovery path, it is a wrong payroll input with a manual undo.
    //
    // `force` because `isProcessed` records that ingestion *looked* at a punch,
    // not that a row came out of it — the two come apart whenever a derive ran
    // and its row was later removed, and they were observed apart in dev. Absent
    // detection is the one caller that cannot afford the difference: skipping a
    // punch here does not delay a row, it writes ABSENT over a day somebody
    // worked. Re-deriving a day that was already right costs an upsert that
    // changes nothing.
    const derivation = await this.derivationService.deriveRange({
      from: input.date,
      to: input.date,
      force: true,
    });

    const holiday = await this.holidayService.findByDate(input.date);

    const summary: CloseSummary = {
      date: toDateKey(input.date),
      employeesConsidered: 0,
      derivation,
      created: { absent: 0, onLeave: 0, notApplicable: 0 },
      conflictsFlagged: 0,
      missingCheckoutFixed: 0,
      untouched: 0,
      skipped: [],
    };

    // Walked in chunks rather than loaded whole. A site's entire headcount plus
    // its rows plus its shifts in one transaction is the first thing that breaks
    // as the company grows, and it breaks at 3am.
    let cursor: string | undefined;

    for (;;) {
      const employees = await this.loadEmployeeChunk(input.date, cursor);

      if (employees.length === 0) break;

      await this.closeChunk({
        employees,
        date: input.date,
        isHoliday: holiday !== null,
        actorId: input.actorId,
        summary,
      });

      if (employees.length < CLOSE_CHUNK_SIZE) break;

      cursor = employees[employees.length - 1].id;
    }

    return summary;
  }

  // ----------------------------------------------------------------- the sweep

  private async closeChunk(input: {
    employees: CloseEmployee[];
    date: Date;
    isHoliday: boolean;
    actorId: string | null;
    summary: CloseSummary;
  }) {
    const { employees, date, summary } = input;
    const employeeIds = employees.map((employee) => employee.id);

    const shiftIds = [
      ...new Set(
        employees
          .map((employee) => employee.shiftId)
          .filter((id): id is string => id !== null),
      ),
    ];

    // Three reads for the whole chunk. Nothing queries inside the loop below —
    // five hundred employees must cost five hundred decisions, not five hundred
    // round trips.
    const [existingRows, shiftOffDays, absences] = await Promise.all([
      this.loadExisting(employeeIds, date),
      this.loadWeeklyOffDays(shiftIds),
      this.leaveService.findApprovedForDate(employeeIds, date),
    ]);

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const auditEntries: AuditEntry[] = [];

    for (const employee of employees) {
      summary.employeesConsidered += 1;

      const weeklyOffDays = employee.shiftId
        ? (shiftOffDays.get(employee.shiftId) ?? null)
        : null;
      const existing = existingRows.get(employee.id) ?? null;
      const absence = absences.get(employee.id) ?? null;

      const action = planCloseDay({
        attendanceDate: date,
        shift:
          employee.shiftId && weeklyOffDays
            ? { id: employee.shiftId, weeklyOffDays }
            : null,
        isHoliday: input.isHoliday,
        existing,
        leave: absence ? { id: absence.id } : null,
      });

      switch (action.kind) {
        case 'SKIP':
          summary.skipped.push({
            employeeId: employee.employeeId,
            reason: action.reason,
          });
          break;

        case 'NOOP':
          summary.untouched += 1;
          break;

        case 'CREATE': {
          // `upsert` rather than `create`: a punch landing between this chunk's
          // read and its write would otherwise turn the whole transaction into a
          // unique-constraint failure, losing four hundred correct rows to one
          // race. Losing the race is the right outcome here — DEVICE outranks
          // SYSTEM, so `update: {}` deliberately keeps the punch's answer.
          writes.push(
            this.prisma.attendance.upsert({
              where: {
                employeeId_attendanceDate: {
                  employeeId: employee.id,
                  attendanceDate: date,
                },
              },
              create: {
                id: randomUUID(),
                employeeId: employee.id,
                attendanceDate: date,
                ...action.data,
              },
              update: {},
            }),
          );

          this.countCreate(summary, action.data.status);
          break;
        }

        case 'FLAG_CONFLICT': {
          // `existing` is non-null on this branch by construction — only
          // `planExisting` returns it.
          writes.push(this.updateRow(existing!.id, action.data));
          auditEntries.push(
            this.auditEntry(existing!, action.data, input.actorId),
          );
          summary.conflictsFlagged += 1;
          break;
        }

        case 'FIX_MISSING_CHECKOUT': {
          writes.push(this.updateRow(existing!.id, action.data));
          auditEntries.push(
            this.auditEntry(existing!, action.data, input.actorId),
          );
          summary.missingCheckoutFixed += 1;
          break;
        }
      }
    }

    // Only changes to rows that already existed are audited. A conflict flag or
    // a status correction is surprising and disputable; a SYSTEM absence is the
    // job's ordinary output, and `source: SYSTEM` on the row already says who
    // wrote it. Logging every absence every night would bury the entries that
    // matter under the ones that do not.
    writes.push(...this.auditService.buildLogWrites(auditEntries));

    if (writes.length === 0) return;

    await this.prisma.$transaction(writes, {
      timeout: 15000,
      maxWait: 10000,
    });
  }

  private updateRow(id: string, data: Prisma.AttendanceUpdateInput) {
    return this.prisma.attendance.update({ where: { id }, data });
  }

  private auditEntry(
    existing: ClosableRow,
    after: AuditEntry['after'],
    actorId: string | null,
  ): AuditEntry {
    return {
      attendanceId: existing.id,
      changedById: actorId,
      before: existing,
      after,
      // No remark. The close job has no reason to give beyond the rule it
      // applied, and inventing one would put words in a human's mouth in a log
      // that a payroll dispute reads as testimony.
    };
  }

  private countCreate(summary: CloseSummary, status: AttendanceStatus) {
    if (status === AttendanceStatus.ON_LEAVE) summary.created.onLeave += 1;
    else if (status === AttendanceStatus.NOT_APPLICABLE) {
      summary.created.notApplicable += 1;
    } else summary.created.absent += 1;
  }

  // -------------------------------------------------------------------- reads

  /**
   * One page of employees on rolls for the date, walked by id.
   *
   * Cursor rather than `skip`: the sweep writes as it goes, and an offset-based
   * walk over a table being written to can skip or repeat rows. Nothing here
   * changes an employee's id, so the cursor is stable for the whole run.
   */
  private async loadEmployeeChunk(date: Date, cursor?: string) {
    return this.prisma.employee.findMany({
      // `employeeEligibleOn` carries an `OR`; composing under `AND` keeps it
      // from being clobbered by anything this filter grows later.
      where: { AND: [employeeEligibleOn(date)] },
      select: EMPLOYEE_SELECT,
      orderBy: { id: 'asc' },
      take: CLOSE_CHUNK_SIZE,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
  }

  private async loadExisting(employeeIds: string[], date: Date) {
    const byEmployee = new Map<string, ClosableRow & { employeeId: string }>();

    if (employeeIds.length === 0) return byEmployee;

    const rows = await this.prisma.attendance.findMany({
      where: { attendanceDate: date, employeeId: { in: employeeIds } },
      select: {
        id: true,
        employeeId: true,
        source: true,
        status: true,
        checkIn: true,
        checkOut: true,
        hasConflict: true,
        plannedAbsenceId: true,
      },
    });

    for (const row of rows) byEmployee.set(row.employeeId, row);

    return byEmployee;
  }

  /**
   * Distinct shifts for the chunk in one query. A site runs three or four shifts
   * across hundreds of people, so an `include` on the employee query would
   * re-fetch the same handful of rows five hundred times.
   *
   * Only `weeklyOffDays` is selected: the close job never runs punch arithmetic,
   * so start, end, break and grace are of no use to it.
   */
  private async loadWeeklyOffDays(shiftIds: string[]) {
    if (shiftIds.length === 0) return new Map<string, number[]>();

    const shifts = await this.prisma.shift.findMany({
      where: { id: { in: shiftIds } },
      select: { id: true, weeklyOffDays: true },
    });

    return new Map(shifts.map((shift) => [shift.id, shift.weeklyOffDays]));
  }

  // ------------------------------------------------------------------- guards

  /**
   * Only a day that has finished may be closed.
   *
   * Today is excluded, not merely the future: closing a day still in progress
   * marks ABSENT everybody who has not punched in yet, on the business's busiest
   * screen, with a status payroll reads. The scheduler targets yesterday for
   * exactly this reason.
   *
   * Phase 10 adds `assertPeriodOpen(date)` here — every write path in this
   * service funnels through `close()`, so this is the only place it needs to go.
   */
  private assertClosable(date: Date, policy: AttendancePolicy) {
    const today = businessToday(policy.businessUtcOffsetMinutes);

    // The business's wall clock, not the host's. At 02:00 IST a UTC server still
    // calls it yesterday and would happily close a day that has barely started.
    if (date.getTime() >= today.getTime()) {
      throw new BadRequestException(
        `Attendance can only be closed for a day that has finished — ${toDateKey(date)} is not in the past`,
      );
    }
  }
}
