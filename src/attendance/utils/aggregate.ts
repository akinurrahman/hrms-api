import {
  netShiftMinutes,
  shiftSpanMinutes,
} from '../../shift/utils/shift-time.js';
import {
  businessInstant,
  minutesBetween,
  MS_PER_MINUTE,
} from '../../common/utils/business-time.js';
import { AttendanceStatus } from '../constants/attendance-enums.js';
import { AttendancePolicy } from '../constants/attendance-policy.constant.js';

/**
 * Pure attendance aggregation. No database, no Nest, no side effects, no
 * reading of the host clock.
 *
 * The biometric ingestion path and the manual override path
 * both call this, so a corrected day and a device day always mean
 * the same thing on the payslip.
 *
 * What it deliberately does not know about:
 *
 * - **Leave, holidays, weekly offs.** Those are resolved before this is
 *   called; the close job runs `existing row -> holiday/weekly-off -> leave ->
 *   absent` and a day matching any earlier branch never reaches here. Hence
 *   ON_LEAVE and NOT_APPLICABLE are never returned.
 * - **HR's opinion.** The result is arithmetic, not a verdict. An admin
 *   overruling it is Phase 7's status mode, which skips this function
 *   entirely rather than passing it a flag.
 */

/** Only the shift fields the arithmetic needs — not the whole Prisma model. */
export interface AggregateShift {
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  graceMinutes: number;
}

export interface AggregateInput {
  checkIn: Date | null;
  checkOut: Date | null;
  /**
   * Required. A missing shift is a hard guard at the caller (PRD §9 case 13):
   * assuming some default 9-to-6 would produce plausible-looking wrong
   * numbers, which is worse than refusing.
   */
  shift: AggregateShift;
  policy: AttendancePolicy;
  /**
   * The day the work is attributed to. For a night shift this is the date the
   * shift *started*, so a 22:00-06:00 shift beginning Jan 5 belongs to Jan 5
   * even though half of it happened on Jan 6.
   */
  attendanceDate: Date;
}

export interface AggregateResult {
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
}

const NO_MINUTES = {
  workedMinutes: 0,
  lateMinutes: 0,
  earlyExitMinutes: 0,
  overtimeMinutes: 0,
} as const;

export function aggregate(input: AggregateInput): AggregateResult {
  const { checkIn, checkOut, shift, policy, attendanceDate } = input;

  const net = netShiftMinutes(shift);

  if (net <= 0) {
    // ShiftService.assertShiftValid() rejects break >= span on the way in, so
    // reaching this is a bug in a caller, not bad user input.
    throw new Error(
      `Shift has no working minutes (span ${shiftSpanMinutes(shift)}, break ${shift.breakMinutes})`,
    );
  }

  // Both boundaries as real instants, so every comparison below is an
  // instant subtraction. Nothing reads getHours() and nothing depends on the
  // timezone of the machine running this.
  const shiftStart = businessInstant(
    attendanceDate,
    shift.startMinutes,
    policy.businessUtcOffsetMinutes,
  );
  const shiftEnd = new Date(
    shiftStart.getTime() + shiftSpanMinutes(shift) * MS_PER_MINUTE,
  );

  // Nobody turned up. Absent for a plain working day; a leave or holiday day
  // never gets this far.
  if (!checkIn && !checkOut) {
    return { status: AttendanceStatus.ABSENT, ...NO_MINUTES };
  }

  // One half of the pair is missing. Worked time is unknowable, so it stays
  // zero and HR resolves it — this status blocks the month lock by design.
  // An OUT with no IN is malformed rather than incomplete, but lands in the
  // same review bucket.
  if (!checkIn || !checkOut) {
    return {
      status: AttendanceStatus.MISSING_CHECKOUT,
      ...NO_MINUTES,
      lateMinutes: checkIn ? lateness(checkIn, shiftStart, shift) : 0,
    };
  }

  const rawSpan = Math.max(0, minutesBetween(checkIn, checkOut));
  const workedMinutes = Math.max(
    0,
    rawSpan - breakToDeduct(rawSpan, shift, policy, net),
  );

  return {
    status: statusFor(workedMinutes, net, policy),
    workedMinutes,
    lateMinutes: lateness(checkIn, shiftStart, shift),
    earlyExitMinutes: Math.max(0, minutesBetween(checkOut, shiftEnd)),
    // Measured against minutes actually worked, never against the clock. A
    // late arrival who leaves late worked less than a full day; comparing
    // clock-out against shift end would hand them overtime for it.
    overtimeMinutes: Math.max(0, workedMinutes - net),
  };
}

function lateness(
  checkIn: Date,
  shiftStart: Date,
  shift: AggregateShift,
): number {
  return Math.max(0, minutesBetween(shiftStart, checkIn) - shift.graceMinutes);
}

/**
 * The break comes off only when the day was long enough to have contained one
 * — otherwise a 09:00-13:00 attendance is billed for a lunch that never
 * happened and falls a bucket lower than it earned.
 *
 * The cutoff derives from the absent threshold rather than being its own
 * magic number.
 */
function breakToDeduct(
  rawSpan: number,
  shift: AggregateShift,
  policy: AttendancePolicy,
  net: number,
): number {
  if (!policy.deductBreakOnlyIfDayLongEnough) {
    return shift.breakMinutes;
  }

  const absentFloor = (net * policy.absentThresholdPercent) / 100;
  return rawSpan > shift.breakMinutes + absentFloor ? shift.breakMinutes : 0;
}

/** Both comparisons are `>=`: working exactly the threshold earns the day. */
function statusFor(
  workedMinutes: number,
  net: number,
  policy: AttendancePolicy,
): AttendanceStatus {
  const workedPercent = (workedMinutes / net) * 100;

  if (workedPercent >= policy.halfDayThresholdPercent) {
    return AttendanceStatus.PRESENT;
  }

  if (workedPercent >= policy.absentThresholdPercent) {
    return AttendanceStatus.HALF_DAY;
  }

  return AttendanceStatus.ABSENT;
}
