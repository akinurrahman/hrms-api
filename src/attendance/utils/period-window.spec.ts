import { PeriodStatus } from '../constants/attendance-enums.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import {
  PeriodWindow,
  calendarMonthWindow,
  findPeriodFor,
  lockedDateKeys,
  rangesOverlap,
} from './period-window.js';

const period = (
  startDate: string,
  endDate: string,
  status: PeriodStatus = PeriodStatus.OPEN,
): PeriodWindow => ({
  startDate: toUtcDateOnly(startDate),
  endDate: toUtcDateOnly(endDate),
  status,
});

const AUGUST = period('2026-08-01', '2026-08-31');

/** A 26-to-25 payroll cycle, labelled September because that is where it ends. */
const SEPTEMBER_CYCLE = period('2026-08-26', '2026-09-25');

describe('findPeriodFor', () => {
  it('includes both bounds', () => {
    expect(findPeriodFor([AUGUST], toUtcDateOnly('2026-08-01'))).toBe(AUGUST);
    expect(findPeriodFor([AUGUST], toUtcDateOnly('2026-08-31'))).toBe(AUGUST);
  });

  it('excludes the day either side', () => {
    expect(findPeriodFor([AUGUST], toUtcDateOnly('2026-07-31'))).toBeNull();
    expect(findPeriodFor([AUGUST], toUtcDateOnly('2026-09-01'))).toBeNull();
  });

  it('returns null when nothing covers the date', () => {
    expect(findPeriodFor([], toUtcDateOnly('2026-08-11'))).toBeNull();
  });

  // The load-bearing case. Anyone who reintroduces month extraction passes every
  // other test in this file and fails these two.
  it('resolves a non-calendar cycle by its bounds, not its label', () => {
    expect(
      findPeriodFor([SEPTEMBER_CYCLE], toUtcDateOnly('2026-08-28')),
    ).toBe(SEPTEMBER_CYCLE);
  });

  it('does not claim a date past the cycle end merely because the month matches', () => {
    expect(
      findPeriodFor([SEPTEMBER_CYCLE], toUtcDateOnly('2026-09-26')),
    ).toBeNull();
  });
});

describe('lockedDateKeys', () => {
  const JULY_LOCKED = period('2026-07-01', '2026-07-31', PeriodStatus.LOCKED);

  it('reports a date inside a locked period', () => {
    expect(
      lockedDateKeys([JULY_LOCKED], [toUtcDateOnly('2026-07-15')]),
    ).toEqual(new Set(['2026-07-15']));
  });

  it('leaves out a date inside an open period', () => {
    expect(lockedDateKeys([AUGUST], [toUtcDateOnly('2026-08-15')]).size).toBe(0);
  });

  // The module's rule: a date no period covers is OPEN. Named as a test so
  // nobody later "fixes" the guard to default closed.
  it('treats a date no period covers as open', () => {
    expect(
      lockedDateKeys([JULY_LOCKED], [toUtcDateOnly('2026-09-02')]).size,
    ).toBe(0);
  });

  it('splits a batch that straddles the lock boundary', () => {
    const dates = [
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ].map(toUtcDateOnly);

    expect(lockedDateKeys([JULY_LOCKED, AUGUST], dates)).toEqual(
      new Set(['2026-07-30', '2026-07-31']),
    );
  });
});

describe('rangesOverlap', () => {
  const range = (startDate: string, endDate: string) => ({
    startDate: toUtcDateOnly(startDate),
    endDate: toUtcDateOnly(endDate),
  });

  it('treats adjacent cycles as separate', () => {
    expect(
      rangesOverlap(range('2026-07-01', '2026-07-31'), range('2026-08-01', '2026-08-31')),
    ).toBe(false);
  });

  it('catches a single shared day', () => {
    expect(
      rangesOverlap(range('2026-07-01', '2026-08-01'), range('2026-08-01', '2026-08-31')),
    ).toBe(true);
  });

  it('catches containment in either direction', () => {
    expect(
      rangesOverlap(range('2026-08-01', '2026-08-31'), range('2026-08-10', '2026-08-12')),
    ).toBe(true);
    expect(
      rangesOverlap(range('2026-08-10', '2026-08-12'), range('2026-08-01', '2026-08-31')),
    ).toBe(true);
  });

  it('catches an identical range', () => {
    expect(
      rangesOverlap(range('2026-08-01', '2026-08-31'), range('2026-08-01', '2026-08-31')),
    ).toBe(true);
  });
});

describe('calendarMonthWindow', () => {
  const key = (date: Date) => date.toISOString().slice(0, 10);

  it('ends on the last day of a short month', () => {
    expect(key(calendarMonthWindow(2026, 2).endDate)).toBe('2026-02-28');
  });

  it('knows about leap years', () => {
    expect(key(calendarMonthWindow(2028, 2).endDate)).toBe('2028-02-29');
  });

  it('does not roll over into the next year in December', () => {
    const december = calendarMonthWindow(2026, 12);

    expect(key(december.startDate)).toBe('2026-12-01');
    expect(key(december.endDate)).toBe('2026-12-31');
  });

  it('takes a 1-12 month, not a zero-based one', () => {
    const january = calendarMonthWindow(2026, 1);

    expect(key(january.startDate)).toBe('2026-01-01');
    expect(key(january.endDate)).toBe('2026-01-31');
  });

  it('returns UTC midnights, so the bounds compare against a @db.Date column', () => {
    const { startDate, endDate } = calendarMonthWindow(2026, 8);

    for (const bound of [startDate, endDate]) {
      expect(bound.getUTCHours()).toBe(0);
      expect(bound.getUTCMinutes()).toBe(0);
      expect(bound.getUTCSeconds()).toBe(0);
      expect(bound.getUTCMilliseconds()).toBe(0);
    }
  });
});
