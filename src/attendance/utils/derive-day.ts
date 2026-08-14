import {
  AttendanceStatus,
  DayType,
  HolidayCompensation,
} from '../constants/attendance-enums.js';
import { AttendancePolicy } from '../constants/attendance-policy.constant.js';
import { AggregateShift, aggregate } from './aggregate.js';

/**
 * One employee-day's punches turned into the row that describes it. Pure: no
 * database, no Nest, no host clock.
 *
 * The split from `AttendanceDerivationService` is the same one `aggregate()`
 * and `resolvePunchDate()` already make — everything that decides anything
 * lives here and is testable without a database, and the service is left doing
 * nothing but batched reads, a precedence branch, and one transaction.
 *
 * What it does *not* decide: whether the row may be written at all. That is
 * source precedence (`canOverwrite`), and it belongs to the caller, which is
 * the only party that knows what is already stored.
 */

/** A punch reduced to what the resolution needs. */
export interface DeriveDayPunch {
  id: string;
  punchedAt: Date;
}

export interface DeriveDayInput {
  /**
   * The day the work is attributed to — UTC midnight of the business-local
   * date, which is what `resolvePunchDate()` produced and what a `@db.Date`
   * column stores.
   */
  attendanceDate: Date;
  shift: AggregateShift & { weeklyOffDays: number[] };
  /** That day's punches, ascending by `punchedAt`. */
  punches: DeriveDayPunch[];
  isHoliday: boolean;
  policy: AttendancePolicy;
}

export interface DeriveDayResult {
  dayType: DayType;
  status: AttendanceStatus;
  checkIn: Date | null;
  checkOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  compensationType: HolidayCompensation | null;
  /**
   * Punches that lost to the first-IN / last-OUT rule. Recomputed from the full
   * set every call rather than accumulated, so a punch arriving later that is
   * *earlier* than the current check-in correctly takes over.
   */
  ignoredPunchIds: string[];
}

/** Statuses that mean work happened, and so can earn holiday compensation. */
const WORKED_STATUSES: readonly AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.HALF_DAY,
];

/** Day types that are not working days, so working one earns compensation. */
const NON_WORKING_DAY_TYPES: readonly DayType[] = [
  DayType.HOLIDAY,
  DayType.WEEKLY_OFF,
];

export function deriveDay(input: DeriveDayInput): DeriveDayResult {
  const { attendanceDate, shift, punches, isHoliday, policy } = input;

  const dayType = resolveDayType(attendanceDate, shift.weeklyOffDays, isHoliday);
  const { checkIn, checkOut, ignoredPunchIds } = resolvePunches(punches);

  const result = aggregate({
    checkIn,
    checkOut,
    shift,
    policy,
    attendanceDate,
  });

  return {
    dayType,
    ...result,
    checkIn,
    checkOut,
    compensationType: resolveCompensation(dayType, result.status, policy),
    ignoredPunchIds,
  };
}

/**
 * Holiday beats weekly off. A declared holiday falling on a Sunday is a
 * holiday: it is already excluded from working days either way, and calling it
 * WEEKLY_OFF would lose the fact that a holiday was declared.
 */
function resolveDayType(
  attendanceDate: Date,
  weeklyOffDays: number[],
  isHoliday: boolean,
): DayType {
  if (isHoliday) return DayType.HOLIDAY;

  // `attendanceDate` is UTC midnight of the business-local date, so the UTC
  // weekday *is* the local weekday. Reading getDay() would use the host's
  // timezone and shift the answer by a day either side of midnight.
  if (weeklyOffDays.includes(attendanceDate.getUTCDay())) {
    return DayType.WEEKLY_OFF;
  }

  return DayType.WORKING;
}

/**
 * First punch is the check-in, last is the check-out, everything between is
 * recorded but excluded from the arithmetic.
 *
 * The `direction` column is deliberately not read. Devices report UNKNOWN far
 * more often than not, so honouring it would mean two code paths where the
 * rarely-exercised one is the one that decides payroll input. Multi-segment
 * days are a later enhancement and the raw punches will still be there for it.
 */
function resolvePunches(punches: DeriveDayPunch[]): {
  checkIn: Date | null;
  checkOut: Date | null;
  ignoredPunchIds: string[];
} {
  if (punches.length === 0) {
    return { checkIn: null, checkOut: null, ignoredPunchIds: [] };
  }

  // Sorting here rather than trusting the caller: the cost is nothing at this
  // size, and a wrong check-in is not the kind of bug that announces itself.
  const ordered = [...punches].sort(
    (a, b) => a.punchedAt.getTime() - b.punchedAt.getTime(),
  );

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  // A lone punch is an incomplete day, not a zero-length one. `aggregate()`
  // turns this into MISSING_CHECKOUT, which blocks the month lock by design.
  if (ordered.length === 1) {
    return {
      checkIn: first.punchedAt,
      checkOut: null,
      ignoredPunchIds: [],
    };
  }

  return {
    checkIn: first.punchedAt,
    checkOut: last.punchedAt,
    ignoredPunchIds: ordered.slice(1, -1).map((punch) => punch.id),
  };
}

/**
 * Only a non-working day that was actually worked earns compensation.
 *
 * Attendance records *which route* was taken, never the rate — cash and
 * comp-off are mutually exclusive and nothing downstream can tell them apart
 * afterwards, so the field has to be populated from day one even though the
 * leave ledger that consumes it does not exist yet.
 */
function resolveCompensation(
  dayType: DayType,
  status: AttendanceStatus,
  policy: AttendancePolicy,
): HolidayCompensation | null {
  const earned =
    NON_WORKING_DAY_TYPES.includes(dayType) && WORKED_STATUSES.includes(status);

  return earned ? policy.defaultCompensationType : null;
}
