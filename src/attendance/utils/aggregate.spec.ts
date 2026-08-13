import { aggregate, AggregateShift } from './aggregate.js';
import { AttendanceStatus } from '../constants/attendance-enums.js';
import {
  AttendancePolicy,
  DEFAULT_ATTENDANCE_POLICY,
} from '../constants/attendance-policy.constant.js';
import { AttendancePolicyService } from '../attendance-policy.service.js';

/**
 * Every instant is written as an explicit `...Z` literal with its IST
 * equivalent in a comment, so the suite proves the same thing on a laptop in
 * Kolkata and on a UTC container.
 */

const policy = DEFAULT_ATTENDANCE_POLICY;
const attendanceDate = new Date('2026-08-13');

/** 09:00-18:00, one hour of lunch. Span 540, net 480. */
const DAY_SHIFT: AggregateShift = {
  startMinutes: 540,
  endMinutes: 1080,
  breakMinutes: 60,
  graceMinutes: 0,
};

/** 22:00-06:00, one hour of break. Span 480, net 420. */
const NIGHT_SHIFT: AggregateShift = {
  startMinutes: 1320,
  endMinutes: 360,
  breakMinutes: 60,
  graceMinutes: 0,
};

const run = (
  checkIn: string | null,
  checkOut: string | null,
  overrides: {
    shift?: AggregateShift;
    policy?: AttendancePolicy;
    attendanceDate?: Date;
  } = {},
) =>
  aggregate({
    checkIn: checkIn ? new Date(checkIn) : null,
    checkOut: checkOut ? new Date(checkOut) : null,
    shift: overrides.shift ?? DAY_SHIFT,
    policy: overrides.policy ?? policy,
    attendanceDate: overrides.attendanceDate ?? attendanceDate,
  });

describe('aggregate', () => {
  describe('a normal day', () => {
    it('marks a full day present with no late or overtime minutes', () => {
      // 09:00 -> 18:00 IST
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T12:30:00Z');

      expect(result).toEqual({
        status: AttendanceStatus.PRESENT,
        workedMinutes: 480,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    it('counts genuine overtime past the net shift', () => {
      // 09:00 -> 20:00 IST
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T14:30:00Z');

      expect(result.workedMinutes).toBe(600);
      expect(result.overtimeMinutes).toBe(120);
      expect(result.status).toBe(AttendanceStatus.PRESENT);
    });

    it('measures the early exit against the shift end', () => {
      // 09:00 -> 16:00 IST, two hours short
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T10:30:00Z');

      expect(result.earlyExitMinutes).toBe(120);
    });
  });

  describe('threshold boundaries', () => {
    // Both comparisons are `>=`. Off-by-one here silently reclassifies a
    // month of attendance.
    it('treats exactly 75% of the net shift as a full day', () => {
      // 09:00 -> 16:00 IST: 420 raw - 60 break = 360 = 75% of 480
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T10:30:00Z');

      expect(result.workedMinutes).toBe(360);
      expect(result.status).toBe(AttendanceStatus.PRESENT);
    });

    it('drops to half day one minute below 75%', () => {
      // 09:00 -> 15:59 IST: 419 raw - 60 = 359
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T10:29:00Z');

      expect(result.workedMinutes).toBe(359);
      expect(result.status).toBe(AttendanceStatus.HALF_DAY);
    });

    it('treats exactly 50% of the net shift as a half day', () => {
      // 09:00 -> 13:00 IST: 240 worked = 50% of 480
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T07:30:00Z');

      expect(result.workedMinutes).toBe(240);
      expect(result.status).toBe(AttendanceStatus.HALF_DAY);
    });

    it('falls to absent one minute below 50%', () => {
      // 09:00 -> 12:59 IST
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T07:29:00Z');

      expect(result.workedMinutes).toBe(239);
      expect(result.status).toBe(AttendanceStatus.ABSENT);
    });
  });

  describe('break deduction', () => {
    it('deducts the break from a day long enough to contain one', () => {
      // 09:00 -> 18:00 IST: 540 raw - 60
      expect(
        run('2026-08-13T03:30:00Z', '2026-08-13T12:30:00Z').workedMinutes,
      ).toBe(480);
    });

    it('does not charge lunch to somebody who left before lunch', () => {
      // 09:00 -> 13:00 IST. Deducting unconditionally would give 180 and
      // push a genuine half day into ABSENT.
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T07:30:00Z');

      expect(result.workedMinutes).toBe(240);
      expect(result.status).toBe(AttendanceStatus.HALF_DAY);
    });

    it('deducts unconditionally when the policy says to', () => {
      const strict: AttendancePolicy = {
        ...policy,
        deductBreakOnlyIfDayLongEnough: false,
      };

      const result = run('2026-08-13T03:30:00Z', '2026-08-13T07:30:00Z', {
        policy: strict,
      });

      expect(result.workedMinutes).toBe(180);
      expect(result.status).toBe(AttendanceStatus.ABSENT);
    });
  });

  describe('lateness and grace', () => {
    const withGrace: AggregateShift = { ...DAY_SHIFT, graceMinutes: 15 };

    it('forgives an arrival inside the grace window', () => {
      // 09:10 IST, grace 15
      const result = run('2026-08-13T03:40:00Z', '2026-08-13T12:30:00Z', {
        shift: withGrace,
      });

      expect(result.lateMinutes).toBe(0);
    });

    it('counts only the minutes beyond grace', () => {
      // 09:16 IST, grace 15
      const result = run('2026-08-13T03:46:00Z', '2026-08-13T12:30:00Z', {
        shift: withGrace,
      });

      expect(result.lateMinutes).toBe(1);
    });
  });

  describe('the late arrival who stays late', () => {
    // The bug this module already caught once: comparing clock-out against
    // shift end hands overtime to somebody who worked less than a full day.
    it('gives no overtime for a two-hour-late arrival leaving an hour late', () => {
      // 11:00 -> 19:00 IST
      const result = run('2026-08-13T05:30:00Z', '2026-08-13T13:30:00Z');

      expect(result.overtimeMinutes).toBe(0);
      expect(result.workedMinutes).toBe(420);
      expect(result.lateMinutes).toBe(120);
      expect(result.earlyExitMinutes).toBe(0);
    });
  });

  describe('night shifts', () => {
    it('attributes a shift crossing midnight to its start date', () => {
      // 22:00 Aug 13 -> 06:00 Aug 14 IST. Phase 1's 420-minute figure.
      const result = run('2026-08-13T16:30:00Z', '2026-08-14T00:30:00Z', {
        shift: NIGHT_SHIFT,
      });

      expect(result).toEqual({
        status: AttendanceStatus.PRESENT,
        workedMinutes: 420,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    // Regression test for the timezone bug. Reading minutes-of-day off the
    // clock gives 30 against a shift start of 1320 and scores this as 0 late.
    it('counts an arrival after midnight as late, not early', () => {
      // 00:30 Aug 14 -> 06:00 Aug 14 IST, on the Aug 13 attendance date
      const result = run('2026-08-13T19:00:00Z', '2026-08-14T00:30:00Z', {
        shift: NIGHT_SHIFT,
      });

      expect(result.lateMinutes).toBe(150);
      expect(result.workedMinutes).toBe(270);
      expect(result.status).toBe(AttendanceStatus.HALF_DAY);
    });
  });

  describe('incomplete and empty days', () => {
    it('flags a check-in with no check-out for review', () => {
      const result = run('2026-08-13T03:30:00Z', null);

      expect(result.status).toBe(AttendanceStatus.MISSING_CHECKOUT);
      expect(result.workedMinutes).toBe(0);
    });

    it('still records lateness on an incomplete day', () => {
      // 11:00 IST, no check-out
      expect(run('2026-08-13T05:30:00Z', null).lateMinutes).toBe(120);
    });

    it('flags a check-out with no check-in for review', () => {
      const result = run(null, '2026-08-13T12:30:00Z');

      expect(result.status).toBe(AttendanceStatus.MISSING_CHECKOUT);
      expect(result.lateMinutes).toBe(0);
    });

    it('marks a day with no punches absent', () => {
      expect(run(null, null)).toEqual({
        status: AttendanceStatus.ABSENT,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    it('marks a zero-length day absent', () => {
      const result = run('2026-08-13T03:30:00Z', '2026-08-13T03:30:00Z');

      expect(result.workedMinutes).toBe(0);
      expect(result.status).toBe(AttendanceStatus.ABSENT);
    });
  });

  describe('nothing is hardcoded', () => {
    // These two fail the moment a threshold or the offset gets inlined into
    // aggregate() instead of being read off the policy.
    it('lets the policy alone decide the verdict for identical punches', () => {
      // 09:00 -> 15:00 IST: 300 worked, 62.5% of the net shift
      const lenient: AttendancePolicy = {
        ...policy,
        halfDayThresholdPercent: 60,
        absentThresholdPercent: 30,
      };

      const strict = run('2026-08-13T03:30:00Z', '2026-08-13T09:30:00Z');
      const relaxed = run('2026-08-13T03:30:00Z', '2026-08-13T09:30:00Z', {
        policy: lenient,
      });

      expect(strict.workedMinutes).toBe(300);
      expect(relaxed.workedMinutes).toBe(300);
      expect(strict.status).toBe(AttendanceStatus.HALF_DAY);
      expect(relaxed.status).toBe(AttendanceStatus.PRESENT);
    });

    it('reads the business offset from the policy', () => {
      const utc: AttendancePolicy = { ...policy, businessUtcOffsetMinutes: 0 };

      // Same instant, two different business clocks: 12:00Z is 17:30 IST
      // (510 minutes past a 09:00 IST start) but 12:00 UTC (180 past a
      // 09:00 UTC start).
      const ist = run('2026-08-13T12:00:00Z', '2026-08-13T12:30:00Z');
      const zulu = run('2026-08-13T12:00:00Z', '2026-08-13T12:30:00Z', {
        policy: utc,
      });

      expect(ist.lateMinutes).toBe(510);
      expect(zulu.lateMinutes).toBe(180);
    });
  });

  describe('guards', () => {
    it('refuses a shift with no working minutes', () => {
      expect(() =>
        run('2026-08-13T03:30:00Z', '2026-08-13T12:30:00Z', {
          shift: { ...DAY_SHIFT, breakMinutes: 540 },
        }),
      ).toThrow(/no working minutes/);
    });
  });
});

describe('AttendancePolicyService', () => {
  it('resolves the defaults and ignores the site argument', async () => {
    const service = new AttendancePolicyService();

    await expect(service.get()).resolves.toEqual(DEFAULT_ATTENDANCE_POLICY);
    await expect(service.get('any-site-id')).resolves.toEqual(
      DEFAULT_ATTENDANCE_POLICY,
    );
  });
});
