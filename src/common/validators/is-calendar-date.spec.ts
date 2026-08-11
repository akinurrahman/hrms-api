import { validateSync } from 'class-validator';
import { IsCalendarDate } from './is-calendar-date.decorator.js';

class Subject {
  @IsCalendarDate()
  date!: string;
}

function errorsFor(value: unknown): string[] {
  const subject = new Subject();
  Object.assign(subject, { date: value });
  return validateSync(subject).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe('IsCalendarDate', () => {
  it('accepts a plain calendar date', () => {
    expect(errorsFor('2026-08-15')).toHaveLength(0);
  });

  it('accepts Feb 29 in a leap year', () => {
    expect(errorsFor('2028-02-29')).toHaveLength(0);
  });

  // The 500 this decorator exists to prevent: the shape is right, the day is
  // not, and toUtcDateOnly() would throw a RangeError past the filter.
  it('rejects a day that does not exist in that month', () => {
    expect(errorsFor('2026-02-30')).toHaveLength(1);
    expect(errorsFor('2026-02-29')).toHaveLength(1);
    expect(errorsFor('2026-13-01')).toHaveLength(1);
  });

  // A timestamp would let the caller believe a time was stored, and an offset
  // would move the day.
  it('rejects a timestamp, offset-bearing or not', () => {
    expect(errorsFor('2026-09-01T01:00:00+05:30')).toHaveLength(1);
    expect(errorsFor('2026-09-01T00:00:00Z')).toHaveLength(1);
  });

  it('rejects non-strings and malformed input', () => {
    expect(errorsFor('not-a-date')).toHaveLength(1);
    expect(errorsFor('2026-8-15')).toHaveLength(1);
    expect(errorsFor(20260815)).toHaveLength(1);
    expect(errorsFor(null)).toHaveLength(1);
    expect(errorsFor(undefined)).toHaveLength(1);
  });

  it('names the property in the message', () => {
    expect(errorsFor('nope')[0]).toContain('date must be a real calendar date');
  });
});
