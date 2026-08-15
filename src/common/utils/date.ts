import { BadRequestException } from '@nestjs/common';
import { format } from 'date-fns';

export function toUtcDateOnly(date: string | Date): Date {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);

    if (match) {
      const [, year, month, day] = match;
      const utc = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day)),
      );

      if (
        utc.getUTCFullYear() !== Number(year) ||
        utc.getUTCMonth() !== Number(month) - 1 ||
        utc.getUTCDate() !== Number(day)
      ) {
        throw new RangeError(`Invalid calendar date: ${date}`);
      }

      return utc;
    }
  }

  const parsed = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date: ${String(date)}`);
  }

  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

/**
 * `toUtcDateOnly`, but for input that came off a request.
 *
 * A DTO regex or `@IsISO8601` accepts shapes the calendar does not — `2026-02-30`
 * passes validation and reaches the service. Left unhandled the `RangeError`
 * escapes `HttpExceptionFilter`, which only catches `HttpException`, and surfaces
 * as a 500 for what is plainly bad input.
 */
export function parseDateOnlyOrThrow(input: Date | string): Date {
  try {
    return toUtcDateOnly(input);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

export function toDateKey(date: Date | string): string {
  return format(toUtcDateOnly(date), 'yyyy-MM-dd');
}

/**
 * Today on the *business's* wall clock, as UTC midnight of that calendar date —
 * the same shape a `@db.Date` column stores, so it compares directly against an
 * `attendanceDate`.
 *
 * Reading the host's date instead would answer the question wrong for several
 * hours a day: at 02:00 IST the server in UTC still calls it yesterday, and the
 * roster would offer to edit a day HR considers the future.
 */
export function businessToday(offsetMinutes: number): Date {
  const shifted = new Date(Date.now() + offsetMinutes * 60_000);

  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
}

/**
 * Hard ceiling on `eachDateInRange`. A leave range longer than a year is a typo
 * in the year field, and expanding it would build a list nobody meant to ask for.
 */
export const MAX_DATE_RANGE_DAYS = 366;

/**
 * Every calendar date from `start` to `end`, both inclusive, as UTC midnights.
 *
 * Inclusive at both ends because that is what a date range means to a human
 * filing leave: the 5th to the 7th is three days off, not two.
 *
 * Walks by UTC calendar field rather than by adding 86,400,000ms, so it cannot
 * drift across a DST boundary — the inputs are `@db.Date` values at UTC
 * midnight and the outputs have to stay that way to compare against one.
 */
export function eachDateInRange(start: Date, end: Date): Date[] {
  const from = toUtcDateOnly(start);
  const to = toUtcDateOnly(end);

  if (from.getTime() > to.getTime()) return [];

  const dates: Date[] = [];
  const cursor = new Date(from);

  while (cursor.getTime() <= to.getTime()) {
    if (dates.length >= MAX_DATE_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
      );
    }

    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Half-open UTC bounds for a calendar year — `start` inclusive, `end` exclusive.
 *
 * The exclusive upper bound is what makes this safe to hand straight to a
 * `{ gte: start, lt: end }` filter: there is no last-instant-of-December to get
 * wrong, and a `@db.Date` column stored at UTC midnight compares cleanly.
 * `date-fns` `startOfYear` works in local time and would shift the boundary by
 * the host's offset.
 */
export function utcYearRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}
