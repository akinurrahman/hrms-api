import { AttendanceStatus, DayType } from '../constants/attendance-enums.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import { PeriodBounds } from './period-window.js';

/**
 * A month of stored attendance rows turned into the counts payroll is paid from.
 * Pure: no database, no Nest, no host clock — the same split `aggregate()`,
 * `deriveDay()` and `planCloseDay()` already make.
 *
 * The whole file rests on one rule (PRD §4.4): **every calendar day an employee
 * is on rolls lands in exactly one bucket**, and the seven buckets sum to
 * `eligibleDays`. That single equation is what catches mid-month joiner
 * arithmetic, gaps left by a failed cron night, employees with no shift, and
 * double-counted holiday work — bugs which otherwise reach payroll looking
 * entirely plausible.
 *
 * Two things deliberately sit outside the buckets. `holidayWorkedDays` and
 * `weeklyOffWorkedDays` are overlays: a worked holiday is already counted in
 * `holidayCount`, and adding it to `presentDays` as well would make a 31-day
 * month sum to 32 and pay for a day that does not exist. And `workingDays` is
 * derived downstream (`eligibleDays - weeklyOffCount - holidayCount`), never
 * stored — storing it alongside its own components is two sources of truth for
 * one number, which disagree the moment a holiday is declared retroactively.
 */

const MS_PER_DAY = 86_400_000;

/** A stored row reduced to what the counts depend on. */
export interface SummaryRow {
  attendanceDate: Date;
  dayType: DayType;
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  plannedAbsenceId: string | null;
}

/** The employee fields eligibility depends on. */
export interface EligibilityFields {
  dateOfJoining: Date;
  lastWorkingDay: Date | null;
}

/** A closed date range, both bounds inclusive. */
export interface DateWindow {
  from: Date;
  to: Date;
}

/** Which bucket a day falls in. `UNBUCKETABLE` is a bug, not a category. */
export const DayBucket = {
  PRESENT: 'PRESENT',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  PAID_LEAVE: 'PAID_LEAVE',
  UNPAID_LEAVE: 'UNPAID_LEAVE',
  HOLIDAY: 'HOLIDAY',
  WEEKLY_OFF: 'WEEKLY_OFF',
  UNBUCKETABLE: 'UNBUCKETABLE',
} as const;

export type DayBucket = (typeof DayBucket)[keyof typeof DayBucket];

/** Every field of `MonthlyAttendanceSummary` this file decides. */
export interface SummaryCounts {
  eligibleDays: number;

  presentDays: number;
  halfDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayCount: number;
  weeklyOffCount: number;

  holidayWorkedDays: number;
  weeklyOffWorkedDays: number;

  totalWorkedMinutes: number;
  totalLateMinutes: number;
  totalEarlyExitMinutes: number;

  normalOvertimeMinutes: number;
  holidayOvertimeMinutes: number;
  weeklyOffOvertimeMinutes: number;
}

export interface ReconciliationResult {
  ok: boolean;
  /** The seven buckets added up — reported even when it matches, so a refusal
   * message can show both sides of the equation rather than one. */
  sum: number;
  eligibleDays: number;
}

/** Statuses that mean the employee actually worked the day. */
const WORKED_STATUSES: readonly AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.HALF_DAY,
];

/**
 * The part of the period this employee was on rolls for, or `null` when they
 * were not on rolls during it at all.
 *
 * The intersection, not the period: `salary × payableDays / eligibleDays` is
 * payroll's base formula, so somebody who joined on the 20th must prorate
 * against eleven days, not thirty-one. A mid-month exit is the same question
 * from the other end.
 *
 * `lastWorkingDay === null` means still employed, so the period's end stands.
 */
export function eligibleWindow(
  period: PeriodBounds,
  employee: EligibilityFields,
): DateWindow | null {
  const periodStart = toUtcDateOnly(period.startDate);
  const periodEnd = toUtcDateOnly(period.endDate);
  const joined = toUtcDateOnly(employee.dateOfJoining);

  const from = joined.getTime() > periodStart.getTime() ? joined : periodStart;

  const exit =
    employee.lastWorkingDay === null
      ? null
      : toUtcDateOnly(employee.lastWorkingDay);

  const to =
    exit !== null && exit.getTime() < periodEnd.getTime() ? exit : periodEnd;

  // Joined after the cycle ended, or left before it began.
  if (from.getTime() > to.getTime()) return null;

  return { from, to };
}

/**
 * Days from `from` to `to`, both inclusive — the 1st to the 31st is 31 days.
 *
 * Arithmetic rather than `eachDateInRange`, which would allocate a list nobody
 * reads. Both bounds are UTC midnights, so no DST offset can creep into the
 * subtraction.
 */
export function countDaysInclusive(from: Date, to: Date): number {
  const start = toUtcDateOnly(from).getTime();
  const end = toUtcDateOnly(to).getTime();

  if (start > end) return 0;

  return (end - start) / MS_PER_DAY + 1;
}

/** Is this date inside the window, both bounds inclusive? */
export function isWithinWindow(date: Date, window: DateWindow): boolean {
  const day = toUtcDateOnly(date).getTime();

  return (
    toUtcDateOnly(window.from).getTime() <= day &&
    day <= toUtcDateOnly(window.to).getTime()
  );
}

/**
 * Rows the employee was on rolls for, and rows they were not.
 *
 * Split in one place rather than in each caller: the pivot and the lock have to
 * agree about which rows count, and a row dated outside the window is both
 * excluded from the arithmetic *and* worth reporting — it means something
 * upstream wrote a day for somebody who had already left.
 */
export function splitByWindow<T extends { attendanceDate: Date }>(
  rows: readonly T[],
  window: DateWindow,
): { inWindow: T[]; outOfWindow: T[] } {
  const inWindow: T[] = [];
  const outOfWindow: T[] = [];

  for (const row of rows) {
    if (isWithinWindow(row.attendanceDate, window)) inWindow.push(row);
    else outOfWindow.push(row);
  }

  return { inWindow, outOfWindow };
}

/**
 * Which bucket one day belongs to.
 *
 * `dayType` is asked first and `status` second, which is the whole of PRD §4.1
 * in one ordering: a holiday somebody worked is still a holiday. The calendar
 * decides what the day *was*; the status only decides what happened on a day
 * that was a working day to begin with.
 *
 * @param isPaidByAbsenceId `PlannedAbsence.id` → `leaveType.isPaid`, which is
 * the only thing splitting paid leave from unpaid. A leave day with no absence
 * to point at cannot be classified, and is reported rather than guessed at.
 */
export function bucketDay(
  row: Pick<SummaryRow, 'dayType' | 'status' | 'plannedAbsenceId'>,
  isPaidByAbsenceId: ReadonlyMap<string, boolean>,
): DayBucket {
  if (row.dayType === DayType.HOLIDAY) return DayBucket.HOLIDAY;
  if (row.dayType === DayType.WEEKLY_OFF) return DayBucket.WEEKLY_OFF;

  switch (row.status) {
    case AttendanceStatus.PRESENT:
      return DayBucket.PRESENT;

    case AttendanceStatus.HALF_DAY:
      // Its own bucket, counting 1 for reconciliation and 0.5 for payable days
      // downstream. Folded into `presentDays` the deduction disappears.
      return DayBucket.HALF_DAY;

    case AttendanceStatus.ABSENT:
      return DayBucket.ABSENT;

    case AttendanceStatus.ON_LEAVE: {
      if (row.plannedAbsenceId === null) return DayBucket.UNBUCKETABLE;

      const isPaid = isPaidByAbsenceId.get(row.plannedAbsenceId);

      if (isPaid === undefined) return DayBucket.UNBUCKETABLE;

      return isPaid ? DayBucket.PAID_LEAVE : DayBucket.UNPAID_LEAVE;
    }

    // NOT_APPLICABLE on a working day contradicts itself, and MISSING_CHECKOUT
    // is an unfinished record rather than a verdict. Both are refused at lock
    // time instead of being quietly counted as something.
    default:
      return DayBucket.UNBUCKETABLE;
  }
}

/**
 * One employee's month.
 *
 * @param rows that employee's rows **inside their eligible window** — see
 * `splitByWindow`. Rows from outside it would inflate the buckets past
 * `eligibleDays` and break reconciliation for a reason that has nothing to do
 * with the month's data.
 */
export function summariseEmployee(input: {
  eligibleDays: number;
  rows: readonly SummaryRow[];
  isPaidByAbsenceId: ReadonlyMap<string, boolean>;
}): SummaryCounts {
  const counts: SummaryCounts = {
    eligibleDays: input.eligibleDays,
    presentDays: 0,
    halfDays: 0,
    absentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    holidayCount: 0,
    weeklyOffCount: 0,
    holidayWorkedDays: 0,
    weeklyOffWorkedDays: 0,
    totalWorkedMinutes: 0,
    totalLateMinutes: 0,
    totalEarlyExitMinutes: 0,
    normalOvertimeMinutes: 0,
    holidayOvertimeMinutes: 0,
    weeklyOffOvertimeMinutes: 0,
  };

  for (const row of input.rows) {
    switch (bucketDay(row, input.isPaidByAbsenceId)) {
      case DayBucket.PRESENT:
        counts.presentDays += 1;
        break;
      case DayBucket.HALF_DAY:
        counts.halfDays += 1;
        break;
      case DayBucket.ABSENT:
        counts.absentDays += 1;
        break;
      case DayBucket.PAID_LEAVE:
        counts.paidLeaveDays += 1;
        break;
      case DayBucket.UNPAID_LEAVE:
        counts.unpaidLeaveDays += 1;
        break;
      case DayBucket.HOLIDAY:
        counts.holidayCount += 1;
        break;
      case DayBucket.WEEKLY_OFF:
        counts.weeklyOffCount += 1;
        break;
      // UNBUCKETABLE is counted nowhere on purpose. It then shows up as a
      // reconciliation shortfall, which is exactly what it is.
    }

    // The overlays. Additional to the bucket above, never instead of it.
    if (WORKED_STATUSES.includes(row.status)) {
      if (row.dayType === DayType.HOLIDAY) counts.holidayWorkedDays += 1;
      if (row.dayType === DayType.WEEKLY_OFF) counts.weeklyOffWorkedDays += 1;
    }

    counts.totalWorkedMinutes += row.workedMinutes;
    counts.totalLateMinutes += row.lateMinutes;
    counts.totalEarlyExitMinutes += row.earlyExitMinutes;

    // Overtime is split by the day it was earned on, because holiday and
    // weekly-off overtime are almost always paid at a different multiplier. The
    // split is trivial here and unrecoverable from a single total afterwards.
    if (row.dayType === DayType.HOLIDAY) {
      counts.holidayOvertimeMinutes += row.overtimeMinutes;
    } else if (row.dayType === DayType.WEEKLY_OFF) {
      counts.weeklyOffOvertimeMinutes += row.overtimeMinutes;
    } else {
      counts.normalOvertimeMinutes += row.overtimeMinutes;
    }
  }

  return counts;
}

/**
 * PRD §4.4's invariant, answered rather than thrown.
 *
 * The two callers want different things from a failure: the monthly sheet shows
 * it as a flag so HR can see which employee is wrong, and the lock refuses the
 * whole month. Throwing here would force the sheet to catch its own arithmetic.
 */
export function checkReconciliation(
  counts: SummaryCounts,
): ReconciliationResult {
  const sum =
    counts.presentDays +
    counts.halfDays +
    counts.absentDays +
    counts.paidLeaveDays +
    counts.unpaidLeaveDays +
    counts.holidayCount +
    counts.weeklyOffCount;

  return {
    ok: sum === counts.eligibleDays,
    sum,
    eligibleDays: counts.eligibleDays,
  };
}
