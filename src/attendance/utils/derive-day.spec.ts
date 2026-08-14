import {
  AttendanceStatus,
  DayType,
  HolidayCompensation,
} from '../constants/attendance-enums.js';
import {
  AttendancePolicy,
  DEFAULT_ATTENDANCE_POLICY,
} from '../constants/attendance-policy.constant.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import { deriveDay, DeriveDayPunch } from './derive-day.js';

/** Business-local wall clock, written the way the office reads it. */
const ist = (dateTime: string) => new Date(`${dateTime}+05:30`);

const punch = (id: string, dateTime: string): DeriveDayPunch => ({
  id,
  punchedAt: ist(dateTime),
});

/** 09:00-18:00 with an hour's break and ten minutes' grace. Net 480. */
const DAY_SHIFT = {
  startMinutes: 540,
  endMinutes: 1080,
  breakMinutes: 60,
  graceMinutes: 10,
  weeklyOffDays: [0],
};

/** 22:00-06:00, hour's break. Net 420. */
const NIGHT_SHIFT = {
  startMinutes: 1320,
  endMinutes: 360,
  breakMinutes: 60,
  graceMinutes: 10,
  weeklyOffDays: [0],
};

// 2026-08-13 is a Thursday, 08-15 a Saturday, 08-16 a Sunday.
const THURSDAY = toUtcDateOnly('2026-08-13');
const SUNDAY = toUtcDateOnly('2026-08-16');

const policy = (overrides: Partial<AttendancePolicy> = {}): AttendancePolicy => ({
  ...DEFAULT_ATTENDANCE_POLICY,
  ...overrides,
});

const derive = (overrides: {
  attendanceDate?: Date;
  shift?: typeof DAY_SHIFT;
  punches?: DeriveDayPunch[];
  isHoliday?: boolean;
  policy?: AttendancePolicy;
}) =>
  deriveDay({
    attendanceDate: overrides.attendanceDate ?? THURSDAY,
    shift: overrides.shift ?? DAY_SHIFT,
    punches: overrides.punches ?? [],
    isHoliday: overrides.isHoliday ?? false,
    policy: overrides.policy ?? policy(),
  });

describe('deriveDay', () => {
  describe('punch resolution', () => {
    it('takes the first punch as check-in and the last as check-out', () => {
      const result = derive({
        punches: [
          punch('a', '2026-08-13T09:02:00'),
          punch('b', '2026-08-13T13:15:00'),
          punch('c', '2026-08-13T14:05:00'),
          punch('d', '2026-08-13T18:30:00'),
        ],
      });

      expect(result.checkIn).toEqual(ist('2026-08-13T09:02:00'));
      expect(result.checkOut).toEqual(ist('2026-08-13T18:30:00'));
      expect(result.status).toBe(AttendanceStatus.PRESENT);
    });

    it('ignores the middle punches and names them', () => {
      const result = derive({
        punches: [
          punch('first', '2026-08-13T09:02:00'),
          punch('lunch-out', '2026-08-13T13:15:00'),
          punch('lunch-in', '2026-08-13T14:05:00'),
          punch('last', '2026-08-13T18:30:00'),
        ],
      });

      expect(result.ignoredPunchIds).toEqual(['lunch-out', 'lunch-in']);
    });

    it('does not read the direction column — order alone decides', () => {
      // Two punches a device labelled backwards. Positional resolution gives
      // the same answer either way, which is the point of not reading it.
      const result = derive({
        punches: [
          punch('a', '2026-08-13T09:00:00'),
          punch('b', '2026-08-13T18:00:00'),
        ],
      });

      expect(result.checkIn).toEqual(ist('2026-08-13T09:00:00'));
      expect(result.checkOut).toEqual(ist('2026-08-13T18:00:00'));
    });

    it('is order-independent — an unsorted batch derives identically', () => {
      const sorted = derive({
        punches: [
          punch('a', '2026-08-13T09:02:00'),
          punch('b', '2026-08-13T13:15:00'),
          punch('c', '2026-08-13T18:30:00'),
        ],
      });

      const shuffled = derive({
        punches: [
          punch('c', '2026-08-13T18:30:00'),
          punch('a', '2026-08-13T09:02:00'),
          punch('b', '2026-08-13T13:15:00'),
        ],
      });

      expect(shuffled).toEqual(sorted);
    });

    it('treats a lone punch as an incomplete day, not a zero-length one', () => {
      const result = derive({
        punches: [punch('only', '2026-08-13T09:45:00')],
      });

      expect(result.status).toBe(AttendanceStatus.MISSING_CHECKOUT);
      expect(result.checkIn).toEqual(ist('2026-08-13T09:45:00'));
      expect(result.checkOut).toBeNull();
      expect(result.workedMinutes).toBe(0);
      // 45 minutes past a 09:00 start, less ten minutes' grace.
      expect(result.lateMinutes).toBe(35);
      expect(result.ignoredPunchIds).toEqual([]);
    });

    it('reports an absent day when nobody punched', () => {
      const result = derive({ punches: [] });

      expect(result.status).toBe(AttendanceStatus.ABSENT);
      expect(result.checkIn).toBeNull();
      expect(result.checkOut).toBeNull();
      expect(result.workedMinutes).toBe(0);
      expect(result.ignoredPunchIds).toEqual([]);
    });
  });

  describe('dayType', () => {
    it('is WORKING on an ordinary weekday', () => {
      expect(derive({ attendanceDate: THURSDAY }).dayType).toBe(
        DayType.WORKING,
      );
    });

    it('is WEEKLY_OFF when the weekday is in the shift roster', () => {
      expect(derive({ attendanceDate: SUNDAY }).dayType).toBe(
        DayType.WEEKLY_OFF,
      );
    });

    it('is HOLIDAY when the date is declared', () => {
      expect(derive({ attendanceDate: THURSDAY, isHoliday: true }).dayType).toBe(
        DayType.HOLIDAY,
      );
    });

    it('lets a declared holiday beat a weekly off', () => {
      // Calling this WEEKLY_OFF would lose the fact that a holiday exists.
      expect(derive({ attendanceDate: SUNDAY, isHoliday: true }).dayType).toBe(
        DayType.HOLIDAY,
      );
    });

    it('reads the weekday in UTC, not the host timezone', () => {
      // Sunday at UTC midnight is Saturday evening in any negative offset. A
      // getDay() here would call this a working day on a US-hosted runner.
      expect(SUNDAY.getUTCDay()).toBe(0);
      expect(derive({ attendanceDate: SUNDAY }).dayType).toBe(
        DayType.WEEKLY_OFF,
      );
    });

    it('honours a roster with more than one off-day', () => {
      const satSun = { ...DAY_SHIFT, weeklyOffDays: [0, 6] };

      expect(
        derive({ attendanceDate: toUtcDateOnly('2026-08-15'), shift: satSun })
          .dayType,
      ).toBe(DayType.WEEKLY_OFF);
      expect(derive({ attendanceDate: THURSDAY, shift: satSun }).dayType).toBe(
        DayType.WORKING,
      );
    });
  });

  describe('arithmetic delegated to aggregate()', () => {
    it('deducts the break and counts overtime against minutes worked', () => {
      // 09:02 to 18:30 is 568 minutes; less a 60-minute break, 508 worked
      // against a net 480 shift.
      const result = derive({
        punches: [
          punch('a', '2026-08-13T09:02:00'),
          punch('b', '2026-08-13T18:30:00'),
        ],
      });

      expect(result.workedMinutes).toBe(508);
      expect(result.overtimeMinutes).toBe(28);
      expect(result.lateMinutes).toBe(0);
      expect(result.earlyExitMinutes).toBe(0);
    });

    it('handles a night shift straddling midnight as one day', () => {
      // 21:55 on the 13th to 06:10 on the 14th: 495 minutes, less the break,
      // 435 against a net 420.
      const result = derive({
        attendanceDate: THURSDAY,
        shift: NIGHT_SHIFT,
        punches: [
          punch('in', '2026-08-13T21:55:00'),
          punch('out', '2026-08-14T06:10:00'),
        ],
      });

      expect(result.status).toBe(AttendanceStatus.PRESENT);
      expect(result.workedMinutes).toBe(435);
      expect(result.overtimeMinutes).toBe(15);
      expect(result.lateMinutes).toBe(0);
    });

    it('drops a short day into HALF_DAY', () => {
      // 09:00 to 14:00 is 300 minutes, which is 62.5% of the net shift.
      const result = derive({
        punches: [
          punch('a', '2026-08-13T09:00:00'),
          punch('b', '2026-08-13T14:00:00'),
        ],
      });

      expect(result.status).toBe(AttendanceStatus.HALF_DAY);
      expect(result.workedMinutes).toBe(300);
    });
  });

  describe('compensationType', () => {
    const workedPunches = [
      punch('a', '2026-08-13T09:02:00'),
      punch('b', '2026-08-13T18:30:00'),
    ];

    it('is null on an ordinary working day', () => {
      expect(derive({ punches: workedPunches }).compensationType).toBeNull();
    });

    it('is set when a declared holiday was worked', () => {
      const result = derive({ isHoliday: true, punches: workedPunches });

      expect(result.dayType).toBe(DayType.HOLIDAY);
      expect(result.status).toBe(AttendanceStatus.PRESENT);
      expect(result.compensationType).toBe(HolidayCompensation.PAID_EXTRA);
    });

    it('is set when a weekly off was worked', () => {
      const result = derive({
        attendanceDate: SUNDAY,
        punches: [
          punch('a', '2026-08-16T09:02:00'),
          punch('b', '2026-08-16T18:30:00'),
        ],
      });

      expect(result.dayType).toBe(DayType.WEEKLY_OFF);
      expect(result.compensationType).toBe(HolidayCompensation.PAID_EXTRA);
    });

    it('is set for a half day worked on a holiday', () => {
      const result = derive({
        isHoliday: true,
        punches: [
          punch('a', '2026-08-13T09:00:00'),
          punch('b', '2026-08-13T14:00:00'),
        ],
      });

      expect(result.status).toBe(AttendanceStatus.HALF_DAY);
      expect(result.compensationType).toBe(HolidayCompensation.PAID_EXTRA);
    });

    it('stays null on a holiday nobody worked', () => {
      const result = derive({ isHoliday: true, punches: [] });

      expect(result.dayType).toBe(DayType.HOLIDAY);
      expect(result.compensationType).toBeNull();
    });

    it('stays null when the holiday punches fell short of a half day', () => {
      // 09:00 to 11:00 is 120 minutes — 25% of the shift, below the absent
      // floor. No work worth compensating happened.
      const result = derive({
        isHoliday: true,
        punches: [
          punch('a', '2026-08-13T09:00:00'),
          punch('b', '2026-08-13T11:00:00'),
        ],
      });

      expect(result.status).toBe(AttendanceStatus.ABSENT);
      expect(result.compensationType).toBeNull();
    });
  });

  describe('nothing is hardcoded', () => {
    it('takes the compensation route from policy', () => {
      const result = derive({
        isHoliday: true,
        punches: [
          punch('a', '2026-08-13T09:02:00'),
          punch('b', '2026-08-13T18:30:00'),
        ],
        policy: policy({
          defaultCompensationType: HolidayCompensation.COMP_OFF,
        }),
      });

      expect(result.compensationType).toBe(HolidayCompensation.COMP_OFF);
    });

    it('reads the business offset rather than assuming IST', () => {
      const punches = [
        punch('a', '2026-08-13T09:02:00'),
        punch('b', '2026-08-13T18:30:00'),
      ];

      // Same instants, a business clock running on UTC: the shift now starts
      // 09:00Z, hours after these punches began, and ends 18:00Z, hours after
      // they finished.
      const utcOffice = derive({
        punches,
        policy: policy({ businessUtcOffsetMinutes: 0 }),
      });

      expect(derive({ punches }).earlyExitMinutes).toBe(0);
      expect(utcOffice.earlyExitMinutes).toBe(300);
    });

    it('takes the thresholds from policy', () => {
      const punches = [
        punch('a', '2026-08-13T09:00:00'),
        punch('b', '2026-08-13T14:00:00'),
      ];

      // 62.5% of the shift: a half day by default, a full one if the bar drops.
      expect(derive({ punches }).status).toBe(AttendanceStatus.HALF_DAY);
      expect(
        derive({ punches, policy: policy({ halfDayThresholdPercent: 60 }) })
          .status,
      ).toBe(AttendanceStatus.PRESENT);
    });
  });
});
