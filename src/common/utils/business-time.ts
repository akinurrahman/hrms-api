import { toUtcDateOnly } from './date.js';

export const MINUTES_IN_DAY = 1440;
export const MS_PER_MINUTE = 60_000;

/**
 * Turns a business-local wall-clock time into the UTC instant it happened at.
 *
 * Shifts store times as minutes from midnight on the *office* clock. Punches
 * are stored as UTC instants. Comparing the two requires knowing the office's
 * offset — and it must be passed in, never read from a module constant and
 * never inferred from the host machine, or the same row produces different
 * answers on a developer laptop and on a UTC server.
 *
 * `minutesFromMidnight` may exceed 1440 or go negative; the arithmetic rolls
 * into the neighbouring day, which is what night shifts need.
 *
 * @example
 * // 09:00 IST on 2026-08-13 is 03:30Z
 * businessInstant(new Date('2026-08-13'), 540, 330)
 */
export function businessInstant(
  dateOnly: Date | string,
  minutesFromMidnight: number,
  utcOffsetMinutes: number,
): Date {
  const midnightUtc = toUtcDateOnly(dateOnly).getTime();
  return new Date(
    midnightUtc + (minutesFromMidnight - utcOffsetMinutes) * MS_PER_MINUTE,
  );
}

/** Whole minutes between two instants. Negative when `to` precedes `from`. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE);
}
