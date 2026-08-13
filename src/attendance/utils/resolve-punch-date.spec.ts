import {
  resolvePunchDate,
  ResolvePunchPolicy,
  ResolvePunchShift,
} from './resolve-punch-date.js';
import { DEFAULT_ATTENDANCE_POLICY } from '../constants/attendance-policy.constant.js';
import { PunchIgnoreReason } from '../constants/punch-ignore-reason.constant.js';

/**
 * Every instant is an explicit `...Z` literal with its IST equivalent in a
 * comment, so the suite proves the same thing on a laptop in Kolkata and on a
 * UTC container. A resolver that only passes in one timezone is the exact bug
 * this file exists to prevent.
 */

const policy: ResolvePunchPolicy = DEFAULT_ATTENDANCE_POLICY;

/** 09:00-18:00. Window under the default brackets: 07:00 -> 21:00. */
const DAY_SHIFT: ResolvePunchShift = { startMinutes: 540, endMinutes: 1080 };

/** 22:00-06:00. Window under the default brackets: 20:00 -> 09:00 next day. */
const NIGHT_SHIFT: ResolvePunchShift = { startMinutes: 1320, endMinutes: 360 };

/** 06:00-23:00. A 17-hour span, used to force overlapping windows. */
const LONG_SHIFT: ResolvePunchShift = { startMinutes: 360, endMinutes: 1380 };

const run = (
  punchedAt: string,
  overrides: {
    shift?: ResolvePunchShift;
    policy?: Partial<ResolvePunchPolicy>;
  } = {},
) =>
  resolvePunchDate({
    punchedAt: new Date(punchedAt),
    shift: overrides.shift ?? DAY_SHIFT,
    policy: { ...policy, ...overrides.policy },
  });

/** Asserts the exact instant, not just the day — a `@db.Date` is UTC midnight. */
const expectDate = (
  result: ReturnType<typeof resolvePunchDate>,
  iso: string,
) => {
  expect(result.attendanceDate?.toISOString()).toBe(iso);
};

describe('resolvePunchDate', () => {
  describe('a day shift', () => {
    it('attributes a punch to the calendar date it happened on', () => {
      // 09:15 IST on 13 Aug
      expectDate(run('2026-08-13T03:45:00Z'), '2026-08-13T00:00:00.000Z');
    });

    it('keeps an evening punch on the same day, not the next one', () => {
      // 20:45 IST on 13 Aug — inside the after-bracket, still 13 Aug
      expectDate(run('2026-08-13T15:15:00Z'), '2026-08-13T00:00:00.000Z');
    });

    it('refuses a punch that belongs to no shift at all', () => {
      // 03:00 IST on 13 Aug — the badge moved, nobody did
      const result = run('2026-08-12T21:30:00Z');

      expect(result).toEqual({
        attendanceDate: null,
        reason: PunchIgnoreReason.OUTSIDE_SHIFT_WINDOW,
      });
    });
  });

  describe('a night shift crossing midnight', () => {
    it('attributes an after-midnight punch to the day the shift started', () => {
      // 02:00 IST on 14 Aug, for the shift that began 22:00 on 13 Aug.
      // The whole module rests on this answer being 13 Aug.
      expectDate(
        run('2026-08-13T20:30:00Z', { shift: NIGHT_SHIFT }),
        '2026-08-13T00:00:00.000Z',
      );
    });

    it('attributes an early arrival to the same day it starts', () => {
      // 21:45 IST on 13 Aug — a quarter hour before the shift begins
      expectDate(
        run('2026-08-13T16:15:00Z', { shift: NIGHT_SHIFT }),
        '2026-08-13T00:00:00.000Z',
      );
    });

    it('does not carry an after-midnight punch across a month boundary', () => {
      // 02:00 IST on 1 Mar, for the shift that began 22:00 on 28 Feb.
      // Filing this under March is how a locked month goes silently wrong.
      expectDate(
        run('2026-02-28T20:30:00Z', { shift: NIGHT_SHIFT }),
        '2026-02-28T00:00:00.000Z',
      );
    });

    it('does not carry an after-midnight punch across a year boundary', () => {
      // 02:00 IST on 1 Jan 2027, for the shift that began 22:00 on 31 Dec
      expectDate(
        run('2026-12-31T20:30:00Z', { shift: NIGHT_SHIFT }),
        '2026-12-31T00:00:00.000Z',
      );
    });
  });

  describe('window boundaries', () => {
    it('accepts a punch landing exactly on the opening bracket', () => {
      // 07:00 IST — shift start less the 120-minute before-bracket
      expectDate(run('2026-08-13T01:30:00Z'), '2026-08-13T00:00:00.000Z');
    });

    it('accepts a punch landing exactly on the closing bracket', () => {
      // 21:00 IST — shift end plus the 180-minute after-bracket
      expectDate(run('2026-08-13T15:30:00Z'), '2026-08-13T00:00:00.000Z');
    });

    it('rejects the minute after the closing bracket', () => {
      // 21:01 IST
      expect(run('2026-08-13T15:31:00Z').attendanceDate).toBeNull();
    });

    it('rejects the minute before the opening bracket', () => {
      // 06:59 IST
      expect(run('2026-08-13T01:29:00Z').attendanceDate).toBeNull();
    });
  });

  describe('overlapping windows', () => {
    // A 17-hour span with a 5-hour before-bracket makes consecutive days'
    // windows overlap, which is the only case where the answer is a choice.
    const wide = { punchWindowBeforeMinutes: 300 };
    const overrides = { shift: LONG_SHIFT, policy: wide };

    it('picks the most recent shift that has actually begun', () => {
      // 02:00 IST on 13 Aug. Both the 12th's and the 13th's windows contain
      // it, but only the 12th's shift has started — this is somebody
      // finishing a very long day, not arriving absurdly early for the next.
      expectDate(
        run('2026-08-12T20:30:00Z', overrides),
        '2026-08-12T00:00:00.000Z',
      );
    });

    it('gives the same answer on a replay', () => {
      // Ingestion is re-runnable by design. A resolver that answered
      // differently the second time would move a day's work silently, and the
      // unique constraint would not catch it.
      const first = run('2026-08-12T20:30:00Z', overrides);
      const second = run('2026-08-12T20:30:00Z', overrides);

      expect(first.attendanceDate?.toISOString()).toBe(
        second.attendanceDate?.toISOString(),
      );
    });
  });

  describe('nothing is hardcoded', () => {
    it('honours a widened before-bracket', () => {
      // 06:00 IST on 13 Aug — three hours before a 09:00 shift
      expect(run('2026-08-13T00:30:00Z').attendanceDate).toBeNull();

      expectDate(
        run('2026-08-13T00:30:00Z', {
          policy: { punchWindowBeforeMinutes: 240 },
        }),
        '2026-08-13T00:00:00.000Z',
      );
    });

    it('honours a widened after-bracket', () => {
      // 21:30 IST on 13 Aug — three and a half hours after an 18:00 shift end
      expect(run('2026-08-13T16:00:00Z').attendanceDate).toBeNull();

      expectDate(
        run('2026-08-13T16:00:00Z', {
          policy: { punchWindowAfterMinutes: 300 },
        }),
        '2026-08-13T00:00:00.000Z',
      );
    });

    it('honours the business offset rather than assuming IST', () => {
      // 07:00Z. On the IST clock that is 12:30 midday, hours after the 12th's
      // night shift closed. On a UTC clock the same instant is still inside
      // it, because the shift then runs 22:00 to 06:00 in UTC terms.
      expect(
        run('2026-08-13T07:00:00Z', { shift: NIGHT_SHIFT }).attendanceDate,
      ).toBeNull();

      expectDate(
        run('2026-08-13T07:00:00Z', {
          shift: NIGHT_SHIFT,
          policy: { businessUtcOffsetMinutes: 0 },
        }),
        '2026-08-12T00:00:00.000Z',
      );
    });
  });
});
