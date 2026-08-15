import { MINUTES_IN_DAY } from '../../shift/utils/shift-time.js';
import { businessInstant } from '../../common/utils/business-time.js';
import {
  AttendanceStatus,
  DayType,
  HolidayCompensation,
} from '../constants/attendance-enums.js';
import { AttendancePolicy } from '../constants/attendance-policy.constant.js';
import { AggregateShift, aggregate } from './aggregate.js';
import { resolveCompensation, resolveDayType } from './derive-day.js';

/**
 * One employee-day as HR decided it, turned into the row that describes it.
 * Pure: no database, no Nest, no host clock.
 *
 * This is `deriveDay()`'s counterpart. The device path starts from punches, this
 * one starts from what a human typed, and both funnel into the same
 * `aggregate()` so a corrected day and a device day mean the same thing on the
 * payslip.
 *
 * What it does *not* decide: whether the write is allowed at all. Source
 * precedence, the period guard and the future-date rule belong to the caller,
 * which is the only party that knows what is already stored and what day it is.
 */

/** The two ways HR can answer a day. Exactly one of them, never both. */
export const OverrideMode = {
  /** HR typed times. Run the arithmetic. */
  TIME: 'TIME',
  /** HR asserted an outcome. Skip the arithmetic entirely. */
  STATUS: 'STATUS',
} as const;

export type OverrideMode = (typeof OverrideMode)[keyof typeof OverrideMode];

export interface ManualOverrideInput {
  /**
   * The day the work is attributed to — UTC midnight of the business-local
   * date, the shape a `@db.Date` column stores.
   */
  attendanceDate: Date;
  shift: AggregateShift & { weeklyOffDays: number[] };
  isHoliday: boolean;
  policy: AttendancePolicy;
  /** Status mode. Mutually exclusive with the times below. */
  status?: AttendanceStatus;
  /** Time mode. Minutes from midnight on the business's wall clock. */
  checkInMinutes?: number;
  checkOutMinutes?: number;
  /**
   * HR's explicit compensation route for a worked holiday or weekly off.
   * Omitted, the policy default applies.
   */
  compensationType?: HolidayCompensation;
}

export interface ManualOverrideResult {
  dayType: DayType;
  status: AttendanceStatus;
  checkIn: Date | null;
  checkOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  compensationType: HolidayCompensation | null;
}

const NO_MINUTES = {
  workedMinutes: 0,
  lateMinutes: 0,
  earlyExitMinutes: 0,
  overtimeMinutes: 0,
} as const;

/** Which mode a payload is asking for. `null` when it is neither or both. */
export function resolveOverrideMode(input: {
  status?: unknown;
  checkIn?: unknown;
  checkOut?: unknown;
}): OverrideMode | null {
  const hasStatus = input.status !== undefined;
  const hasTimes = input.checkIn !== undefined || input.checkOut !== undefined;

  if (hasStatus === hasTimes) return null;

  return hasStatus ? OverrideMode.STATUS : OverrideMode.TIME;
}

export function resolveManualOverride(
  input: ManualOverrideInput,
): ManualOverrideResult {
  const { attendanceDate, shift, isHoliday, policy } = input;

  const dayType = resolveDayType(attendanceDate, shift.weeklyOffDays, isHoliday);

  // Status mode: HR is overruling the arithmetic, not feeding it. Running
  // `aggregate()` with no times would return ABSENT for its own reasons and
  // obscure the fact that a human decided this.
  if (input.status !== undefined) {
    return {
      dayType,
      status: input.status,
      checkIn: null,
      checkOut: null,
      ...NO_MINUTES,
      compensationType: null,
    };
  }

  const checkIn = toInstant(attendanceDate, input.checkInMinutes, policy);
  const checkOut = toInstant(
    attendanceDate,
    rollOvernight(input.checkInMinutes, input.checkOutMinutes),
    policy,
  );

  const result = aggregate({ checkIn, checkOut, shift, policy, attendanceDate });

  // HR picks the *route*, never whether one is owed. A day that earned no
  // compensation cannot be given a comp-off by typing one in, so the explicit
  // value only ever replaces the policy default — it never conjures the field
  // onto a working day or a day nobody actually worked.
  const earned = resolveCompensation(dayType, result.status, policy);

  return {
    dayType,
    ...result,
    checkIn,
    checkOut,
    compensationType: earned === null ? null : (input.compensationType ?? earned),
  };
}

/**
 * A check-out earlier on the clock than the check-in happened the next day.
 *
 * This is the same fact `isNightShift()` reads off a shift's own times, applied
 * to what HR typed: 22:00 to 06:00 is eight hours, not minus sixteen. Pushing
 * the minutes past 1440 rather than adding a day to the date keeps every
 * conversion going through `businessInstant()`, which already rolls into the
 * neighbouring day for exactly this reason.
 *
 * Equal times are left alone — the caller rejects them, because a check-out
 * identical to the check-in is a typo, and reading it as a 24-hour day would
 * quietly hand somebody sixteen hours of overtime.
 */
function rollOvernight(
  checkInMinutes: number | undefined,
  checkOutMinutes: number | undefined,
): number | undefined {
  if (checkInMinutes === undefined || checkOutMinutes === undefined) {
    return checkOutMinutes;
  }

  return checkOutMinutes < checkInMinutes
    ? checkOutMinutes + MINUTES_IN_DAY
    : checkOutMinutes;
}

function toInstant(
  attendanceDate: Date,
  minutes: number | undefined,
  policy: AttendancePolicy,
): Date | null {
  return minutes === undefined
    ? null
    : businessInstant(attendanceDate, minutes, policy.businessUtcOffsetMinutes);
}
