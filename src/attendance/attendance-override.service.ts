import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { businessToday, parseDateOnlyOrThrow, toDateKey } from '../common/utils/date.js';
import { isEmployeeEligibleOn } from '../common/utils/employee-eligibility.js';
import { hhmmToMinutes } from '../shift/utils/shift-time.js';
import { HolidayService } from '../holiday/holiday.service.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import {
  AttendanceAuditService,
  type AuditEntry,
} from './attendance-audit.service.js';
import { AttendanceSource, AttendanceStatus } from './constants/attendance-enums.js';
import { AttendancePolicy } from './constants/attendance-policy.constant.js';
import { canOverwrite } from './utils/attendance-source.js';
import {
  resolveManualOverride,
  resolveOverrideMode,
  type ManualOverrideResult,
} from './utils/manual-override.js';
import { BulkOverrideAttendanceDto } from './dto/bulk-override-attendance.dto.js';
import { OverrideAttendanceDto } from './dto/override-attendance.dto.js';

/** One employee's answer for the batch's date. */
export interface OverrideEntry extends OverrideAttendanceDto {
  employeeId: string;
}

/** Which entry was refused and why. The response names every one of them. */
export interface OverrideFailure {
  employeeId: string;
  reason: string;
}

/**
 * Statuses HR may assert directly.
 *
 * `ON_LEAVE` is missing on purpose: every leave day must point at the record
 * that authorised it, and that record does not exist yet. `NOT_APPLICABLE`
 * belongs to the close job, which decides it from the calendar rather than from
 * an opinion. `PRESENT`, `HALF_DAY` and `MISSING_CHECKOUT` are conclusions of
 * the arithmetic — asserting them directly would let a row claim someone was
 * present with no times to show for it.
 */
const ASSERTABLE_STATUSES: readonly AttendanceStatus[] = [
  AttendanceStatus.ABSENT,
];

const SHIFT_SELECT = {
  id: true,
  startMinutes: true,
  endMinutes: true,
  breakMinutes: true,
  graceMinutes: true,
  weeklyOffDays: true,
} satisfies Prisma.ShiftSelect;

type OverrideShift = Prisma.ShiftGetPayload<{ select: typeof SHIFT_SELECT }>;

type OverrideEmployee = {
  id: string;
  employeeId: string;
  dateOfJoining: Date;
  lastWorkingDay: Date | null;
  shiftId: string | null;
};

type AttendanceRow = Prisma.AttendanceGetPayload<Record<string, never>>;

/** An entry that passed validation, with everything the write needs resolved. */
interface PlannedWrite {
  attendanceId: string;
  employeeId: string;
  shiftId: string;
  existing: AttendanceRow | null;
  result: ManualOverrideResult;
  remark: string;
}

export interface BulkOverrideSummary {
  date: string;
  created: number;
  updated: number;
  attendance: AttendanceRow[];
}

/**
 * HR's write path: the place a human overrules the device.
 *
 * `MANUAL` is the top source rank, so nothing here can lose to a punch. That
 * authority is why two things are non-negotiable in this file:
 *
 * 1. **Every entry is validated before the transaction opens.** Rolling back is
 *    more expensive than not starting, and a failure list assembled up front can
 *    name all thirty bad rows instead of only the first one hit.
 * 2. **Every write is audited in the same transaction.** A row that changed
 *    without a log entry, or a log entry whose row never landed, is worse than
 *    no audit trail at all, because it looks like one.
 *
 * Single and bulk share one planner. They are the same operation at different
 * sizes, and giving them separate implementations is how the two quietly come to
 * disagree about what a valid override is.
 */
@Injectable()
export class AttendanceOverrideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AttendancePolicyService,
    private readonly holidayService: HolidayService,
    private readonly auditService: AttendanceAuditService,
  ) {}

  /**
   * Update one already-decided day.
   *
   * Update-only by design: the id is proof a row exists. Marking a day that has
   * none goes through `bulkOverride`, which is where the (employee, date) pair
   * that would create it lives.
   */
  async override(
    id: string,
    dto: OverrideAttendanceDto,
    actorId: string,
  ): Promise<AttendanceRow> {
    const existing = await this.prisma.attendance.findUnique({
      where: { id },
    });

    if (!existing) throw new NotFoundException('Attendance record not found');

    const summary = await this.apply(
      existing.attendanceDate,
      [{ ...dto, employeeId: existing.employeeId }],
      actorId,
    );

    return summary.attendance[0];
  }

  /** The roster screen's save. All-or-nothing across the whole batch. */
  async bulkOverride(
    dto: BulkOverrideAttendanceDto,
    actorId: string,
  ): Promise<BulkOverrideSummary> {
    return this.apply(
      parseDateOnlyOrThrow(dto.date),
      dto.entries,
      actorId,
    );
  }

  // --------------------------------------------------------------- the core

  private async apply(
    attendanceDate: Date,
    entries: OverrideEntry[],
    actorId: string,
  ): Promise<BulkOverrideSummary> {
    const policy = await this.policyService.get();

    this.assertWritable(attendanceDate, policy);
    this.assertNoDuplicates(entries);

    const employeeIds = entries.map((entry) => entry.employeeId);

    const [employees, existingRows, holiday] = await Promise.all([
      this.loadEmployees(employeeIds),
      this.loadExisting(employeeIds, attendanceDate),
      this.holidayService.findByDate(attendanceDate),
    ]);

    const shifts = await this.loadShifts(employees, existingRows);

    const plans: PlannedWrite[] = [];
    const failures: OverrideFailure[] = [];

    for (const entry of entries) {
      const planned = this.planEntry({
        entry,
        attendanceDate,
        employee: employees.get(entry.employeeId) ?? null,
        existing: existingRows.get(entry.employeeId) ?? null,
        shifts,
        isHoliday: holiday !== null,
        policy,
        fail: (reason: string) =>
          failures.push({ employeeId: entry.employeeId, reason }),
      });

      if (planned) plans.push(planned);
    }

    if (failures.length > 0) this.rejectBatch(entries.length, failures);

    return this.commit(attendanceDate, plans, actorId);
  }

  /**
   * Everything one entry needs decided, or `null` and a recorded failure.
   *
   * Note the order: cheap shape checks first, then the facts that needed a
   * query. An entry that is malformed on its face should not depend on whether
   * the employee happens to exist.
   */
  private planEntry(input: {
    entry: OverrideEntry;
    attendanceDate: Date;
    employee: OverrideEmployee | null;
    existing: AttendanceRow | null;
    shifts: Map<string, OverrideShift>;
    isHoliday: boolean;
    policy: AttendancePolicy;
    fail: (reason: string) => void;
  }): PlannedWrite | null {
    const { entry, attendanceDate, employee, existing, fail } = input;

    const mode = resolveOverrideMode(entry);

    if (mode === null) {
      fail(
        'Provide either a status or a check-in/check-out time, not both and not neither',
      );
      return null;
    }

    if (entry.status !== undefined) {
      if (!ASSERTABLE_STATUSES.includes(entry.status)) {
        fail(this.statusRejection(entry.status));
        return null;
      }
    } else {
      if (entry.checkIn === undefined) {
        fail('A check-out on its own describes nothing — provide a check-in');
        return null;
      }

      if (entry.checkIn === entry.checkOut) {
        fail('Check-out must differ from check-in');
        return null;
      }
    }

    if (!employee) {
      fail('No such employee');
      return null;
    }

    if (!isEmployeeEligibleOn(employee, attendanceDate)) {
      fail(
        `Not on rolls on ${toDateKey(attendanceDate)} — check the joining date and last working day`,
      );
      return null;
    }

    // PRD §9 case 13. Without a shift there is nothing to judge the times
    // against, and assuming some default 9-to-6 produces plausible-looking
    // wrong numbers, which is worse than refusing.
    const shiftId = existing?.shiftId ?? employee.shiftId;
    const shift = shiftId ? input.shifts.get(shiftId) : undefined;

    if (!shift) {
      fail('No shift assigned — attendance cannot be judged without one');
      return null;
    }

    const result = resolveManualOverride({
      attendanceDate,
      shift,
      isHoliday: input.isHoliday,
      policy: input.policy,
      status: entry.status,
      checkInMinutes: toMinutes(entry.checkIn),
      checkOutMinutes: toMinutes(entry.checkOut),
      compensationType: entry.compensationType,
    });

    if (entry.compensationType !== undefined && result.compensationType === null) {
      fail(
        'compensationType applies only to a holiday or weekly off that was actually worked',
      );
      return null;
    }

    // Always true today — MANUAL outranks everything. Routed through the same
    // function anyway so precedence has exactly one implementation; a second
    // rule written inline here is how the two come to disagree.
    if (!canOverwrite(existing?.source ?? null, AttendanceSource.MANUAL)) {
      fail(`Cannot overwrite a ${existing?.source ?? 'stored'} record`);
      return null;
    }

    return {
      // Generated here, not by the database, so the audit rows can point at a
      // row that does not exist yet and still ride the same transaction.
      attendanceId: existing?.id ?? randomUUID(),
      employeeId: entry.employeeId,
      shiftId: shift.id,
      existing,
      result,
      remark: entry.remark,
    };
  }

  private async commit(
    attendanceDate: Date,
    plans: PlannedWrite[],
    actorId: string,
  ): Promise<BulkOverrideSummary> {
    const auditEntries: AuditEntry[] = [];

    const upserts = plans.map((plan) => {
      const data = {
        shiftId: plan.shiftId,
        dayType: plan.result.dayType,
        status: plan.result.status,
        source: AttendanceSource.MANUAL,
        checkIn: plan.result.checkIn,
        checkOut: plan.result.checkOut,
        workedMinutes: plan.result.workedMinutes,
        lateMinutes: plan.result.lateMinutes,
        earlyExitMinutes: plan.result.earlyExitMinutes,
        overtimeMinutes: plan.result.overtimeMinutes,
        compensationType: plan.result.compensationType,
        remark: plan.remark,
        markedById: actorId,
        // HR editing the row *is* the human decision the flag was waiting for.
        // The contradiction is not lost — the audit entry's `before` still has
        // it, which is the difference between resolving a conflict and hiding
        // one.
        hasConflict: false,
        conflictNote: null,
      };

      auditEntries.push({
        attendanceId: plan.attendanceId,
        changedById: actorId,
        before: plan.existing,
        after: data,
        remark: plan.remark,
      });

      return this.prisma.attendance.upsert({
        where: {
          employeeId_attendanceDate: {
            employeeId: plan.employeeId,
            attendanceDate,
          },
        },
        create: {
          id: plan.attendanceId,
          employeeId: plan.employeeId,
          attendanceDate,
          ...data,
        },
        // `plannedAbsenceId` is absent from both branches on purpose: it belongs
        // to the leave path, and a manual edit has no business clearing the link
        // between a day and the absence that authorised it.
        update: data,
      });
    });

    const writes: Prisma.PrismaPromise<unknown>[] = [
      ...upserts,
      ...this.auditService.buildLogWrites(auditEntries),
    ];

    const results = await this.prisma.$transaction(writes, {
      timeout: 15000,
      maxWait: 10000,
    });

    return {
      date: toDateKey(attendanceDate),
      created: plans.filter((plan) => plan.existing === null).length,
      updated: plans.filter((plan) => plan.existing !== null).length,
      attendance: results.slice(0, upserts.length) as AttendanceRow[],
    };
  }

  // ------------------------------------------------------------------ guards

  /**
   * Phase 10 slots `assertPeriodOpen(date)` in here, and this is the only place
   * it will need to go — every write path in this service funnels through
   * `apply()`.
   *
   * Today the only closed thing is the future. Without the rule somebody marks
   * the whole team present for next week; pre-approved absence is
   * `PlannedAbsence`'s job (PRD §6.3).
   */
  private assertWritable(date: Date, policy: AttendancePolicy) {
    const today = businessToday(policy.businessUtcOffsetMinutes);

    // The business's wall clock, not the host's. At 02:00 IST a UTC server
    // still calls it yesterday and would refuse a perfectly legitimate edit.
    if (date.getTime() > today.getTime()) {
      throw new BadRequestException(
        `Attendance cannot be marked for a future date (${toDateKey(date)})`,
      );
    }
  }

  /**
   * Two entries for the same employee-day is an ambiguous request, not a
   * last-write-wins one — and silently applying the second would make the audit
   * log show a change nobody asked for.
   */
  private assertNoDuplicates(entries: OverrideEntry[]) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const entry of entries) {
      if (seen.has(entry.employeeId)) duplicates.add(entry.employeeId);
      seen.add(entry.employeeId);
    }

    if (duplicates.size > 0) {
      throw new BadRequestException(
        `Repeated employees in one batch: ${[...duplicates].join(', ')}`,
      );
    }
  }

  private statusRejection(status: AttendanceStatus): string {
    if (status === AttendanceStatus.ON_LEAVE) {
      return 'ON_LEAVE requires a backing leave record, which this build cannot create yet';
    }

    if (status === AttendanceStatus.NOT_APPLICABLE) {
      return 'NOT_APPLICABLE is derived from the calendar, not asserted';
    }

    return `${status} is a result of the times worked — provide a check-in and check-out instead`;
  }

  private rejectBatch(total: number, failures: OverrideFailure[]): never {
    throw new BadRequestException({
      message: `Nothing was saved: ${failures.length} of ${total} entries were rejected`,
      errors: failures,
    });
  }

  // ------------------------------------------------------------------- reads

  private async loadEmployees(ids: string[]) {
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        employeeId: true,
        dateOfJoining: true,
        lastWorkingDay: true,
        shiftId: true,
      },
    });

    return new Map<string, OverrideEmployee>(
      employees.map((employee) => [employee.id, employee]),
    );
  }

  private async loadExisting(employeeIds: string[], attendanceDate: Date) {
    const rows = await this.prisma.attendance.findMany({
      where: { attendanceDate, employeeId: { in: employeeIds } },
    });

    return new Map<string, AttendanceRow>(
      rows.map((row) => [row.employeeId, row]),
    );
  }

  /**
   * A stored row's own `shiftId` wins over the employee's current one. That
   * denormalised column exists precisely so a day stays judged against the shift
   * it was worked under; re-reading the employee's present shift would silently
   * re-score history every time somebody is moved to a new roster.
   */
  private async loadShifts(
    employees: Map<string, OverrideEmployee>,
    existingRows: Map<string, AttendanceRow>,
  ) {
    const ids = new Set<string>();

    for (const employee of employees.values()) {
      if (employee.shiftId) ids.add(employee.shiftId);
    }
    for (const row of existingRows.values()) {
      if (row.shiftId) ids.add(row.shiftId);
    }

    if (ids.size === 0) return new Map<string, OverrideShift>();

    const shifts = await this.prisma.shift.findMany({
      where: { id: { in: [...ids] } },
      select: SHIFT_SELECT,
    });

    return new Map(shifts.map((shift) => [shift.id, shift]));
  }
}

function toMinutes(value: string | undefined): number | undefined {
  return value === undefined ? undefined : hhmmToMinutes(value);
}
