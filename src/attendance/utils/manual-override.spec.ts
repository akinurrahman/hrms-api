import {
  OverrideMode,
  resolveManualOverride,
  resolveOverrideMode,
  type ManualOverrideInput,
} from './manual-override.js';
import { hhmmToMinutes } from '../../shift/utils/shift-time.js';
import {
  AttendanceStatus,
  DayType,
  HolidayCompensation,
} from '../constants/attendance-enums.js';
import { DEFAULT_ATTENDANCE_POLICY } from '../constants/attendance-policy.constant.js';

/**
 * Times go in as the `HH:mm` HR types and come out as explicit `...Z` instants,
 * so the suite proves the same thing on a laptop in Kolkata and on a UTC
 * container. The policy offset is IST (+330).
 */

const policy = DEFAULT_ATTENDANCE_POLICY;

/** 2026-08-13 was a Thursday — a working day under the shifts below. */
const attendanceDate = new Date('2026-08-13');

/** 09:00-18:00 IST, one hour of lunch, ten minutes of grace. Net 480. */
const DAY_SHIFT = {
  startMinutes: 540,
  endMinutes: 1080,
  breakMinutes: 60,
  graceMinutes: 10,
  weeklyOffDays: [0],
};

/** 22:00-06:00 IST, one hour of break. Span 480, net 420. */
const NIGHT_SHIFT = {
  startMinutes: 1320,
  endMinutes: 360,
  breakMinutes: 60,
  graceMinutes: 0,
  weeklyOffDays: [0],
};

const run = (overrides: Partial<ManualOverrideInput> = {}) =>
  resolveManualOverride({
    attendanceDate,
    shift: DAY_SHIFT,
    isHoliday: false,
    policy,
    ...overrides,
  });

/** Time mode, written the way the DTO delivers it. */
const times = (checkIn?: string, checkOut?: string) => ({
  checkInMinutes: checkIn === undefined ? undefined : hhmmToMinutes(checkIn),
  checkOutMinutes: checkOut === undefined ? undefined : hhmmToMinutes(checkOut),
});

describe('resolveOverrideMode', () => {
  it('reads times as time mode and a status as status mode', () => {
    expect(resolveOverrideMode({ checkIn: '09:00' })).toBe(OverrideMode.TIME);
    expect(resolveOverrideMode({ checkOut: '18:00' })).toBe(OverrideMode.TIME);
    expect(resolveOverrideMode({ status: AttendanceStatus.ABSENT })).toBe(
      OverrideMode.STATUS,
    );
  });

  it('refuses a payload that is both modes or neither', () => {
    expect(
      resolveOverrideMode({ status: AttendanceStatus.ABSENT, checkIn: '09:00' }),
    ).toBeNull();
    expect(resolveOverrideMode({})).toBeNull();
  });
});

describe('resolveManualOverride', () => {
  describe('time mode', () => {
    it('turns a typed day into instants and runs the arithmetic', () => {
      const result = run(times('09:15', '18:30'));

      expect(result).toEqual({
        dayType: DayType.WORKING,
        status: AttendanceStatus.PRESENT,
        // 09:15 and 18:30 IST
        checkIn: new Date('2026-08-13T03:45:00Z'),
        checkOut: new Date('2026-08-13T13:00:00Z'),
        workedMinutes: 495,
        // 15 minutes late, 10 of them inside grace.
        lateMinutes: 5,
        earlyExitMinutes: 0,
        overtimeMinutes: 15,
        compensationType: null,
      });
    });

    it('rolls a night shift check-out into the next day', () => {
      const result = run({ shift: NIGHT_SHIFT, ...times('22:00', '06:00') });

      // 22:00 on the 13th and 06:00 on the 14th, both IST.
      expect(result.checkIn).toEqual(new Date('2026-08-13T16:30:00Z'));
      expect(result.checkOut).toEqual(new Date('2026-08-14T00:30:00Z'));
      expect(result.workedMinutes).toBe(420);
      expect(result.overtimeMinutes).toBe(0);
      expect(result.status).toBe(AttendanceStatus.PRESENT);
    });

    it('leaves a lone check-in incomplete rather than guessing the exit', () => {
      const result = run(times('09:00'));

      expect(result.status).toBe(AttendanceStatus.MISSING_CHECKOUT);
      expect(result.checkOut).toBeNull();
      expect(result.workedMinutes).toBe(0);
    });

    it('drops a short day to half and then to absent', () => {
      expect(run(times('09:00', '15:00')).status).toBe(
        AttendanceStatus.HALF_DAY,
      );
      expect(run(times('09:00', '11:00')).status).toBe(AttendanceStatus.ABSENT);
    });
  });

  describe('status mode', () => {
    it('records the decision and leaves the arithmetic alone', () => {
      const result = run({ status: AttendanceStatus.ABSENT });

      expect(result).toEqual({
        dayType: DayType.WORKING,
        status: AttendanceStatus.ABSENT,
        checkIn: null,
        checkOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
        compensationType: null,
      });
    });

    it('keeps dayType independent of the status HR chose', () => {
      const result = run({ status: AttendanceStatus.ABSENT, isHoliday: true });

      expect(result.dayType).toBe(DayType.HOLIDAY);
      expect(result.status).toBe(AttendanceStatus.ABSENT);
      // Absent on a holiday earned nothing, whatever the day type says.
      expect(result.compensationType).toBeNull();
    });
  });

  describe('day type', () => {
    it('reads a weekly off from the shift', () => {
      // 2026-08-16 is a Sunday, and Sunday is in DAY_SHIFT.weeklyOffDays.
      const result = run({
        attendanceDate: new Date('2026-08-16'),
        status: AttendanceStatus.ABSENT,
      });

      expect(result.dayType).toBe(DayType.WEEKLY_OFF);
    });

    it('lets a declared holiday outrank a weekly off', () => {
      const result = run({
        attendanceDate: new Date('2026-08-16'),
        isHoliday: true,
        status: AttendanceStatus.ABSENT,
      });

      expect(result.dayType).toBe(DayType.HOLIDAY);
    });
  });

  describe('compensation', () => {
    it('defaults from policy when a non-working day was worked', () => {
      const result = run({ isHoliday: true, ...times('09:00', '18:00') });

      expect(result.dayType).toBe(DayType.HOLIDAY);
      expect(result.compensationType).toBe(policy.defaultCompensationType);
    });

    it('lets HR pick the route instead of the default', () => {
      const result = run({
        isHoliday: true,
        compensationType: HolidayCompensation.COMP_OFF,
        ...times('09:00', '18:00'),
      });

      expect(result.compensationType).toBe(HolidayCompensation.COMP_OFF);
    });

    it('never conjures compensation onto a day that earned none', () => {
      // A plain working day, and a holiday nobody actually worked.
      expect(
        run({
          compensationType: HolidayCompensation.COMP_OFF,
          ...times('09:00', '18:00'),
        }).compensationType,
      ).toBeNull();

      expect(
        run({
          isHoliday: true,
          compensationType: HolidayCompensation.COMP_OFF,
          ...times('09:00', '10:00'),
        }).compensationType,
      ).toBeNull();
    });
  });
});
