export const MINUTES_IN_DAY = 1440;

export interface ShiftTimes {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Derived, never stored. A flag alongside the times is a second source of
 * truth that can disagree with them.
 */
export function isNightShift(shift: ShiftTimes): boolean {
  return shift.endMinutes < shift.startMinutes;
}

/** Wall-clock length of the shift, break included. */
export function shiftSpanMinutes(shift: ShiftTimes): number {
  return isNightShift(shift)
    ? shift.endMinutes + MINUTES_IN_DAY - shift.startMinutes
    : shift.endMinutes - shift.startMinutes;
}

/**
 * The denominator every attendance percentage is measured against:
 * span minus the unpaid break.
 */
export function netShiftMinutes(
  shift: ShiftTimes & { breakMinutes: number },
): number {
  return shiftSpanMinutes(shift) - shift.breakMinutes;
}

/** `545` -> `"09:05"`. Display only; storage stays integer minutes. */
export function minutesToHHmm(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * `"09:05"` -> `545`. The inverse of `minutesToHHmm`, for the times HR types
 * into the roster.
 *
 * Deliberately strict: the DTO's regex has already rejected anything that is
 * not `HH:mm`, so a bad value here is a caller bug and gets a plain `Error`
 * rather than a friendly message it is too late to show anyone.
 */
export function hhmmToMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) throw new Error(`Not a HH:mm time: ${value}`);

  return Number(match[1]) * 60 + Number(match[2]);
}
