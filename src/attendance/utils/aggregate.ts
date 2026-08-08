import type { AttendanceStatus } from '../../generated/prisma/enums.js';

/**
 * Pure attendance aggregation logic.
 *
 * No database, no Nest, no side effects. Takes a punch pair (checkIn/checkOut)
 * and a shift definition, returns the derived status + minute breakdown that
 * gets stored on the Attendance row.
 *
 * Used by BOTH the manual admin-marking path and the future biometric
 * aggregation job, so both sources of truth always agree.
 *
 * IMPORTANT ASSUMPTION: the Date objects passed in must already represent
 * correct wall-clock time in your business timezone (IST). If you're
 * constructing them from ISO strings with a +05:30 offset, .getHours() /
 * .getMinutes() on the resulting Date already give you the right numbers
 * in Node, so you don't need date-fns-tz for this specific function.
 */

export interface ShiftDefinition {
  startMinutes: number; // minutes from midnight, e.g. 540 = 09:00
  endMinutes: number; // minutes from midnight, e.g. 1080 = 18:00
  breakMinutes: number;
  graceMinutes: number;
  isNightShift: boolean;
}

export interface AggregateInput {
  checkIn: Date | null;
  checkOut: Date | null;
  shift: ShiftDefinition | null;
  /** ratio of net shift minutes below which the day counts as ABSENT despite a punch. Default 0.5 */
  absentThreshold?: number;
  /** ratio of net shift minutes below which the day counts as HALF_DAY. Default 0.85 */
  halfDayThreshold?: number;
}

export interface AggregateResult {
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  overtimeMinutes: number;
}

const EMPTY: Omit<AggregateResult, 'status'> = {
  workedMinutes: 0,
  lateMinutes: 0,
  earlyOutMinutes: 0,
  overtimeMinutes: 0,
};

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function shiftLengthMinutes(shift: ShiftDefinition): number {
  if (shift.isNightShift) {
    // e.g. start 1320 (22:00), end 360 (06:00) -> (1440-1320) + 360 = 480
    return 1440 - shift.startMinutes + shift.endMinutes;
  }
  return shift.endMinutes - shift.startMinutes;
}

export function aggregate(input: AggregateInput): AggregateResult {
  const {
    checkIn,
    checkOut,
    shift,
    absentThreshold = 0.5,
    halfDayThreshold = 0.85,
  } = input;

  // No punches at all -> plain absent. Leave/holiday/week-off are set
  // by whoever calls this (they short-circuit before even calling aggregate).
  if (!checkIn && !checkOut) {
    return { status: 'ABSENT', ...EMPTY };
  }

  // Punch exists but incomplete (still clocked in, or malformed data).
  // Can't derive worked time meaningfully yet — leave it at zero and let
  // an admin resolve it. Still worth capturing lateness if we have checkIn.
  if (!checkIn || !checkOut) {
    const lateMinutes =
      checkIn && shift
        ? Math.max(
            0,
            minutesOfDay(checkIn) - (shift.startMinutes + shift.graceMinutes),
          )
        : 0;
    return { status: 'PRESENT', ...EMPTY, lateMinutes };
  }

  // No shift on record — can't compute late/early/OT, just raw worked time.
  if (!shift) {
    const rawMinutes = Math.max(
      0,
      Math.round((checkOut.getTime() - checkIn.getTime()) / 60000),
    );
    return {
      status: rawMinutes > 0 ? 'PRESENT' : 'ABSENT',
      ...EMPTY,
      workedMinutes: rawMinutes,
    };
  }

  const rawMinutes = Math.max(
    0,
    Math.round((checkOut.getTime() - checkIn.getTime()) / 60000),
  );
  const workedMinutes = Math.max(0, rawMinutes - shift.breakMinutes);

  const lateMinutes = Math.max(
    0,
    minutesOfDay(checkIn) - (shift.startMinutes + shift.graceMinutes),
  );

  const earlyOutMinutes = Math.max(
    0,
    shift.endMinutes - minutesOfDay(checkOut),
  );

  const shiftLength = shiftLengthMinutes(shift);
  const netShiftMinutes = Math.max(1, shiftLength - shift.breakMinutes); // avoid div-by-zero

  // Overtime is extra HOURS WORKED beyond what the shift required, not just
  // "left after shift-end o'clock". Comparing against clock time alone would
  // wrongly count a late arrival's own catch-up hours as overtime.
  const overtimeMinutes = Math.max(0, workedMinutes - netShiftMinutes);

  const ratio = workedMinutes / netShiftMinutes;

  let status: AttendanceStatus;
  if (ratio < absentThreshold) {
    status = 'ABSENT';
  } else if (ratio < halfDayThreshold) {
    status = 'HALF_DAY';
  } else {
    status = 'PRESENT';
  }

  return {
    status,
    workedMinutes,
    lateMinutes,
    earlyOutMinutes,
    overtimeMinutes,
  };
}
