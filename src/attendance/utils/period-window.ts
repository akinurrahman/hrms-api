import { PeriodStatus } from '../constants/attendance-enums.js';
import { toDateKey, toUtcDateOnly } from '../../common/utils/date.js';

/**
 * Date arithmetic for payroll cycles. Pure: no database, no Nest, no host clock —
 * the same split `aggregate()`, `deriveDay()` and `planCloseDay()` already make.
 *
 * Every function here resolves a period by comparing against its `startDate` and
 * `endDate`. Nothing extracts a month from a date, and nothing may start to: the
 * `year`/`month` pair is the label a payslip prints, not the boundary payroll
 * runs on, and a 26-to-25 cycle makes the two disagree for six days out of every
 * thirty.
 */

/** A period reduced to what a date decision depends on. */
export interface PeriodWindow {
  /** UTC midnight, as a `@db.Date` column stores it. Inclusive. */
  startDate: Date;
  /** Inclusive — the last day the cycle covers, not the first day after it. */
  endDate: Date;
  status: PeriodStatus;
}

/** The two columns an overlap question is asked about. */
export interface PeriodBounds {
  startDate: Date;
  endDate: Date;
}

/**
 * The period covering `date`, or `null` when none does.
 *
 * A linear scan is correct here and stays correct: callers load only the periods
 * overlapping their own range, which is one or two rows, never a table. The
 * service's no-overlap rule is what makes "the" period well defined — without it
 * a date could sit in two periods with different statuses and the answer would
 * depend on row order.
 */
export function findPeriodFor<T extends PeriodWindow>(
  periods: readonly T[],
  date: Date,
): T | null {
  const day = toUtcDateOnly(date).getTime();

  for (const period of periods) {
    // Both bounds inclusive: a cycle ending 25 Aug covers 25 Aug.
    if (
      toUtcDateOnly(period.startDate).getTime() <= day &&
      day <= toUtcDateOnly(period.endDate).getTime()
    ) {
      return period;
    }
  }

  return null;
}

/**
 * Every date in `dates` that falls inside a LOCKED period, as `yyyy-MM-dd` keys.
 *
 * A key set rather than the rows, mirroring `HolidayService.findDateKeysIn`:
 * every caller only asks "is this day locked", and a key set makes the lookup
 * O(1) without each of them re-deriving date equality itself.
 *
 * A date no period covers is absent from the set. That is the module's rule —
 * missing means OPEN — expressed in the one place every batch caller reads it.
 */
export function lockedDateKeys(
  periods: readonly PeriodWindow[],
  dates: readonly Date[],
): Set<string> {
  const keys = new Set<string>();

  for (const date of dates) {
    const period = findPeriodFor(periods, date);

    if (period?.status === PeriodStatus.LOCKED) keys.add(toDateKey(date));
  }

  return keys;
}

/**
 * Do two closed date ranges share a day?
 *
 * The standard formulation: two ranges overlap when each starts on or before the
 * other ends. Touching bounds do not overlap — 1-31 Jul and 1-31 Aug are
 * adjacent cycles, not a conflict.
 */
export function rangesOverlap(a: PeriodBounds, b: PeriodBounds): boolean {
  return (
    toUtcDateOnly(a.startDate).getTime() <= toUtcDateOnly(b.endDate).getTime() &&
    toUtcDateOnly(b.startDate).getTime() <= toUtcDateOnly(a.endDate).getTime()
  );
}

/**
 * The bounds a label defaults to — 2026-08-01 to 2026-08-31 for August 2026.
 *
 * `Date.UTC(year, month, 0)` is day zero of the *following* month, which is the
 * last day of this one. That handles February, leap years and the December
 * rollover without a table of month lengths, and it stays in UTC so the result
 * compares directly against a `@db.Date` column. `date-fns` `endOfMonth` works in
 * local time and would shift the boundary by the host's offset.
 *
 * @param month 1-12, as the label states it — not a zero-based `Date` month.
 */
export function calendarMonthWindow(
  year: number,
  month: number,
): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1)),
    endDate: new Date(Date.UTC(year, month, 0)),
  };
}
