import { toDateKey, todayUtc, toUtcDateOnly, utcYearRange } from './date.js';

describe('date-only helpers', () => {
  describe('toUtcDateOnly', () => {
    it('reads a YYYY-MM-DD string as UTC midnight', () => {
      expect(toUtcDateOnly('2026-08-15').toISOString()).toBe(
        '2026-08-15T00:00:00.000Z',
      );
    });

    it('keeps the calendar day the caller wrote, ignoring any offset', () => {
      // 2026-08-15T23:30+05:30 is 18:00Z on the 15th; a naive parse-then-truncate
      // would also give the 15th, but +05:30 at 01:00 local would give the 14th.
      expect(toUtcDateOnly('2026-08-15T01:00:00+05:30').toISOString()).toBe(
        '2026-08-15T00:00:00.000Z',
      );
    });

    it('truncates a Date by its UTC parts', () => {
      expect(
        toUtcDateOnly(new Date('2026-08-15T18:45:12.500Z')).toISOString(),
      ).toBe('2026-08-15T00:00:00.000Z');
    });

    it('is idempotent', () => {
      const once = toUtcDateOnly('2026-01-26');
      expect(toUtcDateOnly(once).toISOString()).toBe(once.toISOString());
    });

    it('rejects a day that does not exist in that month', () => {
      expect(() => toUtcDateOnly('2026-02-30')).toThrow(RangeError);
    });

    it('accepts Feb 29 in a leap year and rejects it otherwise', () => {
      expect(toUtcDateOnly('2028-02-29').toISOString()).toBe(
        '2028-02-29T00:00:00.000Z',
      );
      expect(() => toUtcDateOnly('2026-02-29')).toThrow(RangeError);
    });

    it('rejects unparseable input', () => {
      expect(() => toUtcDateOnly('not-a-date')).toThrow(RangeError);
    });
  });

  describe('toDateKey', () => {
    it('formats a Date in UTC, not local time', () => {
      // 23:30Z is the next day in IST — a local-time format would say the 16th.
      expect(toDateKey(new Date('2026-08-15T23:30:00Z'))).toBe('2026-08-15');
    });

    it('round-trips with toUtcDateOnly', () => {
      expect(toDateKey(toUtcDateOnly('2026-01-26'))).toBe('2026-01-26');
    });

    it('zero-pads single-digit months and days', () => {
      expect(toDateKey('2026-01-05')).toBe('2026-01-05');
    });
  });

  describe('todayUtc', () => {
    it('has no time component', () => {
      const today = todayUtc();
      expect(today.getUTCHours()).toBe(0);
      expect(today.getUTCMinutes()).toBe(0);
      expect(today.getUTCSeconds()).toBe(0);
      expect(today.getUTCMilliseconds()).toBe(0);
    });
  });

  describe('utcYearRange', () => {
    it('spans Jan 1 inclusive to the next Jan 1 exclusive', () => {
      const { start, end } = utcYearRange(2026);
      expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('covers Dec 31 of the requested year and excludes Jan 1 of the next', () => {
      const { start, end } = utcYearRange(2026);
      const dec31 = toUtcDateOnly('2026-12-31');
      const jan1 = toUtcDateOnly('2027-01-01');

      expect(dec31 >= start && dec31 < end).toBe(true);
      expect(jan1 < end).toBe(false);
    });
  });
});
