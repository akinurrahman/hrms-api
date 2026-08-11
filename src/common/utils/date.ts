import { UTCDate } from '@date-fns/utc';
import { addYears, format, startOfDay } from 'date-fns';

/**
 * Date-only helpers for the `@db.Date` columns in the attendance chain.
 *
 * Every value that lands in or is compared against a `@db.Date` column must be
 * UTC midnight. A `Date` carrying a local-time component compares wrong across
 * the day boundary, which is the exact class of bug `@db.Date` was chosen to
 * avoid in the first place.
 *
 * **Project convention.** date-fns is local-time by default — `startOfDay()` on
 * a plain `Date` gives local midnight, which is wrong here. So every date-fns
 * call in this codebase takes a `UTCDate`, which reinterprets the same instant
 * with UTC getters. `UTCDate` extends `Date`, so Prisma accepts the result
 * directly with no unwrapping.
 *
 * Interval math (`eachDayOfInterval`, `differenceInCalendarDays`, …) goes
 * through date-fns on a `UTCDate`. Anything crossing into or out of Prisma goes
 * through `toUtcDateOnly` first.
 */

/** Leading `YYYY-MM-DD` of a date string. */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

/** The `YYYY-MM-DD` shape the API speaks and Map keys use. */
export const DATE_KEY_FORMAT = 'yyyy-MM-dd';

/**
 * UTC midnight for the calendar day named by `input`.
 *
 * A string is read as a calendar date, never as an instant: `'2026-08-15'` and
 * `'2026-08-15T01:00:00+05:30'` both give 2026-08-15, because the caller wrote
 * the day they meant — an offset-aware parse would give the 14th for the
 * second one. That is a decision about caller intent, not something a date
 * library can pick for us, which is why this path stays hand-rolled.
 *
 * A `Date` is truncated with UTC getters, since that is how Prisma hands
 * `@db.Date` values back.
 *
 * @throws RangeError when the value is not a parseable calendar date.
 */
export function toUtcDateOnly(input: string | Date): Date {
  if (typeof input === 'string') {
    const match = DATE_ONLY_PATTERN.exec(input);

    if (match) {
      const [, year, month, day] = match;
      const date = new UTCDate(+year, +month - 1, +day);

      // Rejects 2026-02-30 and friends, which the Date constructor would
      // silently roll over into the next month.
      if (
        date.getUTCFullYear() !== +year ||
        date.getUTCMonth() !== +month - 1 ||
        date.getUTCDate() !== +day
      ) {
        throw new RangeError(`Invalid calendar date: ${input}`);
      }

      return date;
    }
  }

  const parsed = input instanceof Date ? input : new Date(input);

  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date: ${String(input)}`);
  }

  return startOfDay(new UTCDate(parsed));
}

/** UTC midnight for today. */
export function todayUtc(): Date {
  return startOfDay(new UTCDate());
}

/**
 * `YYYY-MM-DD` for a date, read in UTC.
 *
 * The key type for every date-indexed lookup map in the module — `Date` cannot
 * be a Map key, since two `Date`s for the same instant are different object
 * references and `map.get()` misses.
 */
export function toDateKey(date: Date | string): string {
  return format(new UTCDate(toUtcDateOnly(date)), DATE_KEY_FORMAT);
}

/**
 * Half-open `[start, end)` range covering a calendar year in UTC.
 *
 * Half-open rather than inclusive so the upper bound needs no "last instant of
 * Dec 31" arithmetic — the classic form of that bug is an inclusive bound at
 * Dec 31 midnight quietly excluding anything stamped later that day.
 */
export function utcYearRange(year: number): { start: Date; end: Date } {
  const start = new UTCDate(year, 0, 1);

  return { start, end: addYears(start, 1) };
}
