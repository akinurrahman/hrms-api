import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { toDateKey, toUtcDateOnly } from '../common/utils/date.js';
import { isEmployeeEligibleOn } from '../common/utils/employee-eligibility.js';
import { HolidayService } from '../holiday/holiday.service.js';
import { AttendancePeriodService } from './attendance-period.service.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import { AttendanceSource } from './constants/attendance-enums.js';
import { AttendancePolicy } from './constants/attendance-policy.constant.js';
import {
  DERIVATION_OWNED_IGNORE_REASONS,
  PunchIgnoreReason,
} from './constants/punch-ignore-reason.constant.js';
import { canOverwrite } from './utils/attendance-source.js';
import { deriveDay } from './utils/derive-day.js';
import { DeriveAttendanceDto } from './dto/derive-attendance.dto.js';

/** One employee-day to derive. */
export interface DerivationPair {
  employeeId: string;
  attendanceDate: Date;
}

/** Why an employee-day produced no row. Never silent — always reported. */
export const DerivationSkipReason = {
  UNKNOWN_EMPLOYEE: 'UNKNOWN_EMPLOYEE',
  NO_SHIFT_ASSIGNED: 'NO_SHIFT_ASSIGNED',
  NOT_ON_ROLLS: 'NOT_ON_ROLLS',
  NO_PUNCHES: 'NO_PUNCHES',
  /** The day falls in a locked payroll period. See `plan()` for why this skips. */
  PERIOD_LOCKED: 'PERIOD_LOCKED',
} as const;

export type DerivationSkipReason =
  (typeof DerivationSkipReason)[keyof typeof DerivationSkipReason];

export interface SkippedDay {
  employeeId: string;
  attendanceDate: string;
  reason: DerivationSkipReason;
}

export interface DerivationSummary {
  /** Employee-days that produced or refreshed a row. */
  derived: number;
  rowsCreated: number;
  rowsUpdated: number;
  /** Days where a device write lost to a human decision and was flagged. */
  conflicts: number;
  skipped: SkippedDay[];
}

/** The employee facts derivation needs, loaded once per batch. */
type DerivationEmployee = {
  id: string;
  dateOfJoining: Date;
  lastWorkingDay: Date | null;
  shift: {
    id: string;
    startMinutes: number;
    endMinutes: number;
    breakMinutes: number;
    graceMinutes: number;
    weeklyOffDays: number[];
  } | null;
};

type PunchRow = {
  id: string;
  employeeId: string;
  punchedAt: Date;
  attendanceDate: Date | null;
};

type ExistingRow = {
  employeeId: string;
  attendanceDate: Date;
  source: AttendanceSource;
  status: string;
};

const EMPTY_SUMMARY: DerivationSummary = {
  derived: 0,
  rowsCreated: 0,
  rowsUpdated: 0,
  conflicts: 0,
  skipped: [],
};

/**
 * Turns stored punches into `Attendance` rows.
 *
 * All of the deciding happens in `deriveDay()`, which is pure. This class does
 * four batched reads, applies source precedence, and writes once. It never
 * loops a query per employee-day — a device that has been offline for a week
 * hands over hundreds of days at once.
 *
 * **It never invents a row.** An employee-day with no usable punches is skipped
 * and reported, not marked absent. Deciding that a day with no punches was an
 * absence is the nightly close job's call, and it has to consider holidays,
 * weekly offs and leave before it can make it.
 */
@Injectable()
export class AttendanceDerivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AttendancePolicyService,
    private readonly periodService: AttendancePeriodService,
    private readonly holidayService: HolidayService,
  ) {}

  async deriveDays(pairs: DerivationPair[]): Promise<DerivationSummary> {
    const unique = this.dedupe(pairs);

    if (unique.length === 0) return { ...EMPTY_SUMMARY, skipped: [] };

    const policy = await this.policyService.get();

    const employeeIds = [...new Set(unique.map((pair) => pair.employeeId))];
    const dates = this.distinctDates(unique);

    const [employees, punchesByKey, existingByKey, holidayKeys, lockedKeys] =
      await Promise.all([
        this.loadEmployees(employeeIds),
        this.loadPunches(employeeIds, dates),
        this.loadExisting(employeeIds, dates),
        this.holidayService.findDateKeysIn(dates),
        // Fifth read, same round trip as the other four. One query for the whole
        // batch is what keeps `plan()` synchronous — see its locked-day branch.
        this.periodService.loadLockedDates(dates),
      ]);

    const plan = this.plan({
      pairs: unique,
      employees,
      punchesByKey,
      existingByKey,
      holidayKeys,
      lockedKeys,
      policy,
    });

    if (plan.writes.length > 0) {
      await this.prisma.$transaction(plan.writes, {
        timeout: 15000,
        maxWait: 10000,
      });
    }

    return plan.summary;
  }

  /** The request-shaped entry point: resolves the badge code and the dates. */
  async derive(dto: DeriveAttendanceDto): Promise<DerivationSummary> {
    const from = this.parseDateOnly(dto.from);
    const to = this.parseDateOnly(dto.to);

    if (from > to) {
      throw new BadRequestException('`from` must not be later than `to`');
    }

    // Throws where `deriveDays` skips, and the difference is the audience. A
    // human named this range and is waiting on an answer; telling them every day
    // of it was skipped answers a question they did not ask. The device feed's
    // tolerance for a partly derivable batch is a property of the feed, not of
    // this endpoint.
    await this.periodService.assertRangeOpen(from, to);

    return this.deriveRange({
      from,
      to,
      employeeId: await this.resolveEmployeeId(dto.employeeCode),
      force: dto.force,
    });
  }

  /**
   * Derive every day that has punches waiting in a date range.
   *
   * `force` re-reads days already processed, which is what makes a corrected
   * `aggregate()` or a retroactively declared holiday (PRD §9 case 15)
   * applicable to history — the punches are still there, so the answer can
   * always be recomputed.
   *
   * No period guard of its own, deliberately. All three callers are already
   * covered: `derive()` above throws, `AttendanceCloseService.close()` throws
   * before it gets here, and `PlannedAbsenceService.cancel()` throws before its
   * transaction opens. What reaches `deriveDays` from here skips locked days
   * anyway, so a guard at this level would only turn that skip into a refusal.
   */
  async deriveRange(range: {
    from: Date;
    to: Date;
    employeeId?: string;
    force?: boolean;
  }): Promise<DerivationSummary> {
    const punches = await this.prisma.attendancePunch.findMany({
      where: {
        attendanceDate: { gte: range.from, lte: range.to, not: null },
        ...(range.employeeId && { employeeId: range.employeeId }),
        ...(range.force ? {} : { isProcessed: false }),
        ...this.derivableIgnoreFilter(),
      },
      select: { employeeId: true, attendanceDate: true },
      distinct: ['employeeId', 'attendanceDate'],
    });

    return this.deriveDays(
      punches
        .filter(
          (punch): punch is { employeeId: string; attendanceDate: Date } =>
            punch.attendanceDate !== null,
        )
        .map((punch) => ({
          employeeId: punch.employeeId,
          attendanceDate: punch.attendanceDate,
        })),
    );
  }

  // ---------------------------------------------------------------- planning

  private plan(input: {
    pairs: DerivationPair[];
    employees: Map<string, DerivationEmployee>;
    punchesByKey: Map<string, PunchRow[]>;
    existingByKey: Map<string, ExistingRow>;
    holidayKeys: Set<string>;
    /** `yyyy-MM-dd` keys of days sitting in a LOCKED period. */
    lockedKeys: Set<string>;
    policy: AttendancePolicy;
  }) {
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const skipped: SkippedDay[] = [];

    // Punch ids batched across the whole plan: two updateMany calls at the end
    // rather than two per employee-day.
    const midDayPunchIds: string[] = [];
    const appliedPunchIds: string[] = [];

    let derived = 0;
    let rowsCreated = 0;
    let rowsUpdated = 0;
    let conflicts = 0;

    for (const pair of input.pairs) {
      const key = this.keyOf(pair.employeeId, pair.attendanceDate);
      const employee = input.employees.get(pair.employeeId);

      const skip = (reason: DerivationSkipReason) =>
        skipped.push({
          employeeId: pair.employeeId,
          attendanceDate: toDateKey(pair.attendanceDate),
          reason,
        });

      // First, and ahead of every reason below it. A locked period is a fact
      // about the day, not about this employee — reporting NO_SHIFT_ASSIGNED or
      // NO_PUNCHES for a day nobody may write to would send somebody off to fix
      // the wrong thing.
      //
      // It skips rather than throwing, which is deliberate and is the one place
      // this module treats a lock as anything other than a refusal. A batch
      // arrives here off a device, and a device that has been offline for a week
      // hands over dates either side of the lock boundary in one payload. Throw,
      // and none of the open days ever derive — on every retry, permanently.
      // `AttendancePunchService` already made this exact call for the same
      // reason (see its class comment on partial acceptance).
      //
      // Nothing is lost by skipping: the punches were committed before this ran
      // and stay committed. The lock stops the derived row moving, not the
      // evidence arriving. The punches are also left `isProcessed: false` on
      // purpose — the `continue` fires before the id accumulation below — so a
      // plain re-derive picks the day up the moment the period is unlocked,
      // without anyone having to remember `force`.
      if (input.lockedKeys.has(toDateKey(pair.attendanceDate))) {
        skip(DerivationSkipReason.PERIOD_LOCKED);
        continue;
      }

      if (!employee) {
        skip(DerivationSkipReason.UNKNOWN_EMPLOYEE);
        continue;
      }

      // PRD §9 case 13. Without a shift there is nothing to judge the day
      // against, and inventing one produces plausible-looking wrong numbers.
      if (!employee.shift) {
        skip(DerivationSkipReason.NO_SHIFT_ASSIGNED);
        continue;
      }

      if (!isEmployeeEligibleOn(employee, pair.attendanceDate)) {
        skip(DerivationSkipReason.NOT_ON_ROLLS);
        continue;
      }

      const punches = input.punchesByKey.get(key) ?? [];

      // No evidence, no row. See the class comment.
      if (punches.length === 0) {
        skip(DerivationSkipReason.NO_PUNCHES);
        continue;
      }

      const result = deriveDay({
        attendanceDate: pair.attendanceDate,
        shift: employee.shift,
        punches,
        isHoliday: input.holidayKeys.has(toDateKey(pair.attendanceDate)),
        policy: input.policy,
      });

      // Every punch we looked at has now been considered, whether or not the
      // row was written — otherwise the derive endpoint picks them up forever.
      const ignoredIds = new Set(result.ignoredPunchIds);
      midDayPunchIds.push(...result.ignoredPunchIds);
      appliedPunchIds.push(
        ...punches.filter((p) => !ignoredIds.has(p.id)).map((p) => p.id),
      );

      const existing = input.existingByKey.get(key) ?? null;
      const where = {
        employeeId_attendanceDate: {
          employeeId: pair.employeeId,
          attendanceDate: pair.attendanceDate,
        },
      };

      if (!canOverwrite(existing?.source ?? null, AttendanceSource.DEVICE)) {
        // PRD §4.2. The punch is stored and stays stored; the row HR decided is
        // not touched. Nothing is silently resolved — the roster shows the
        // contradiction and a human picks.
        writes.push(
          this.prisma.attendance.update({
            where,
            data: {
              hasConflict: true,
              conflictNote: this.conflictNote(result.checkIn, existing),
            },
          }),
        );
        conflicts += 1;
        rowsUpdated += 1;
        continue;
      }

      const row = {
        shiftId: employee.shift.id,
        dayType: result.dayType,
        status: result.status,
        source: AttendanceSource.DEVICE,
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        workedMinutes: result.workedMinutes,
        lateMinutes: result.lateMinutes,
        earlyExitMinutes: result.earlyExitMinutes,
        overtimeMinutes: result.overtimeMinutes,
        compensationType: result.compensationType,
      };

      writes.push(
        this.prisma.attendance.upsert({
          where,
          // `update` lists only the fields derivation owns. `remark`,
          // `markedById` and `plannedAbsenceId` belong to other write paths and
          // survive a re-derive untouched.
          create: {
            employeeId: pair.employeeId,
            attendanceDate: pair.attendanceDate,
            ...row,
          },
          update: row,
        }),
      );

      derived += 1;
      if (existing) rowsUpdated += 1;
      else rowsCreated += 1;
    }

    writes.push(...this.punchFlagWrites(appliedPunchIds, midDayPunchIds));

    return {
      writes,
      summary: { derived, rowsCreated, rowsUpdated, conflicts, skipped },
    };
  }

  /**
   * Both directions, deliberately. The ignore set is recomputed from scratch
   * every run, so a punch that was mid-day last time and is now the check-in
   * has to have the flag cleared, not merely not re-set.
   */
  private punchFlagWrites(appliedIds: string[], midDayIds: string[]) {
    const writes: Prisma.PrismaPromise<unknown>[] = [];

    if (appliedIds.length > 0) {
      writes.push(
        this.prisma.attendancePunch.updateMany({
          where: { id: { in: appliedIds } },
          data: { isProcessed: true, isIgnored: false, ignoreReason: null },
        }),
      );
    }

    if (midDayIds.length > 0) {
      writes.push(
        this.prisma.attendancePunch.updateMany({
          where: { id: { in: midDayIds } },
          data: {
            isProcessed: true,
            isIgnored: true,
            ignoreReason: PunchIgnoreReason.MID_DAY_PUNCH,
          },
        }),
      );
    }

    return writes;
  }

  private conflictNote(checkIn: Date | null, existing: ExistingRow | null) {
    const punchedAt = checkIn ? checkIn.toISOString() : 'an unresolved time';

    return `Device punch at ${punchedAt} contradicts the manually recorded ${existing?.status ?? 'status'}. Review and decide.`;
  }

  // ------------------------------------------------------------------- reads

  private async loadEmployees(ids: string[]) {
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        dateOfJoining: true,
        lastWorkingDay: true,
        shift: {
          select: {
            id: true,
            startMinutes: true,
            endMinutes: true,
            breakMinutes: true,
            graceMinutes: true,
            weeklyOffDays: true,
          },
        },
      },
    });

    return new Map<string, DerivationEmployee>(
      employees.map((employee) => [employee.id, employee]),
    );
  }

  /**
   * One query for the batch, grouped in memory. The `in`/`in` pair
   * over-fetches the cross-product of employees and dates; that is far cheaper
   * than a round trip per employee-day, and the grouping discards the excess.
   */
  private async loadPunches(employeeIds: string[], dates: Date[]) {
    const punches = await this.prisma.attendancePunch.findMany({
      where: {
        employeeId: { in: employeeIds },
        attendanceDate: { in: dates },
        ...this.derivableIgnoreFilter(),
      },
      select: {
        id: true,
        employeeId: true,
        punchedAt: true,
        attendanceDate: true,
      },
      orderBy: { punchedAt: 'asc' },
    });

    const grouped = new Map<string, PunchRow[]>();

    for (const punch of punches) {
      if (!punch.attendanceDate) continue;

      const key = this.keyOf(punch.employeeId, punch.attendanceDate);
      const bucket = grouped.get(key);

      if (bucket) bucket.push(punch);
      else grouped.set(key, [punch]);
    }

    return grouped;
  }

  /**
   * Punches derivation is allowed to consider: the ones nothing has ruled out,
   * plus the ones only derivation itself ruled out.
   *
   * Re-reading its own `MID_DAY_PUNCH` rows is what makes reprocessing
   * order-independent. Filtering on `isIgnored: false` alone would freeze the
   * first run's verdict, so a punch arriving late and earlier than the current
   * check-in could never take over.
   */
  private derivableIgnoreFilter(): Prisma.AttendancePunchWhereInput {
    return {
      OR: [
        { isIgnored: false },
        { ignoreReason: { in: [...DERIVATION_OWNED_IGNORE_REASONS] } },
      ],
    };
  }

  private async loadExisting(employeeIds: string[], dates: Date[]) {
    const rows = await this.prisma.attendance.findMany({
      where: {
        employeeId: { in: employeeIds },
        attendanceDate: { in: dates },
      },
      select: {
        employeeId: true,
        attendanceDate: true,
        source: true,
        status: true,
      },
    });

    return new Map<string, ExistingRow>(
      rows.map((row) => [this.keyOf(row.employeeId, row.attendanceDate), row]),
    );
  }

  // ------------------------------------------------------------------ helpers

  private keyOf(employeeId: string, date: Date): string {
    return `${employeeId}|${toDateKey(date)}`;
  }

  private async resolveEmployeeId(employeeCode?: string) {
    if (!employeeCode) return undefined;

    const employee = await this.prisma.employee.findUnique({
      where: { employeeId: employeeCode },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException(`No employee with code ${employeeCode}`);
    }

    return employee.id;
  }

  /**
   * `toUtcDateOnly` throws `RangeError` for a shape the DTO allows but the
   * calendar does not — `2026-02-30`. Unhandled it escapes
   * `HttpExceptionFilter`, which only catches `HttpException`, and surfaces as
   * a 500 for what is plainly bad input.
   */
  private parseDateOnly(input: string): Date {
    try {
      return toUtcDateOnly(input);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Normalise to UTC midnight and drop repeats. Ingestion can hand over the
   * same employee-day many times in one batch — four punches on one day is one
   * derivation, not four.
   */
  private dedupe(pairs: DerivationPair[]): DerivationPair[] {
    const seen = new Map<string, DerivationPair>();

    for (const pair of pairs) {
      const attendanceDate = toUtcDateOnly(pair.attendanceDate);
      seen.set(this.keyOf(pair.employeeId, attendanceDate), {
        employeeId: pair.employeeId,
        attendanceDate,
      });
    }

    return [...seen.values()];
  }

  private distinctDates(pairs: DerivationPair[]): Date[] {
    const seen = new Map<string, Date>();

    for (const pair of pairs) {
      seen.set(toDateKey(pair.attendanceDate), pair.attendanceDate);
    }

    return [...seen.values()];
  }
}
