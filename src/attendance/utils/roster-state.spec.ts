import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import {
  ROSTER_NOT_MARKED,
  RosterAttendance,
  resolveRosterState,
} from './roster-state.js';

// 2026-08-13 is a Thursday, 08-16 a Sunday.
const THURSDAY = toUtcDateOnly('2026-08-13');
const SUNDAY = toUtcDateOnly('2026-08-16');

const SUNDAY_OFF = [0];

const resolve = (overrides: {
  attendanceDate?: Date;
  isHoliday?: boolean;
  weeklyOffDays?: number[] | null;
  attendance?: RosterAttendance | null;
  isFuture?: boolean;
  hasPlannedAbsence?: boolean;
}) =>
  resolveRosterState({
    attendanceDate: overrides.attendanceDate ?? THURSDAY,
    isHoliday: overrides.isHoliday ?? false,
    weeklyOffDays:
      overrides.weeklyOffDays === undefined
        ? SUNDAY_OFF
        : overrides.weeklyOffDays,
    attendance: overrides.attendance ?? null,
    isFuture: overrides.isFuture ?? false,
    hasPlannedAbsence: overrides.hasPlannedAbsence ?? false,
  });

const row = (overrides: Partial<RosterAttendance> = {}): RosterAttendance => ({
  dayType: DayType.WORKING,
  status: AttendanceStatus.PRESENT,
  source: AttendanceSource.DEVICE,
  hasConflict: false,
  ...overrides,
});

describe('resolveRosterState', () => {
  describe('a stored row', () => {
    it('is reported as-is, not recomputed', () => {
      const state = resolve({ attendance: row() });

      expect(state).toMatchObject({
        dayType: DayType.WORKING,
        status: AttendanceStatus.PRESENT,
        isMarked: true,
        source: AttendanceSource.DEVICE,
      });
    });

    it('outranks every computed state', () => {
      // HR marked a declared holiday falling on the weekly off as worked. The
      // computation would have said HOLIDAY / NOT_MARKED; the decision wins.
      const state = resolve({
        attendanceDate: SUNDAY,
        isHoliday: true,
        attendance: row({
          dayType: DayType.HOLIDAY,
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.MANUAL,
        }),
      });

      expect(state.status).toBe(AttendanceStatus.PRESENT);
      expect(state.source).toBe(AttendanceSource.MANUAL);
      expect(state.isMarked).toBe(true);
    });

    it('surfaces a conflict for HR to resolve', () => {
      const state = resolve({ attendance: row({ hasConflict: true }) });

      expect(state.hasConflict).toBe(true);
    });
  });

  describe('no stored row', () => {
    it('describes a plain working day as not marked', () => {
      const state = resolve({});

      expect(state).toMatchObject({
        dayType: DayType.WORKING,
        status: ROSTER_NOT_MARKED,
        isMarked: false,
        source: null,
        hasConflict: false,
      });
    });

    it('reads the weekly off from the shift', () => {
      const state = resolve({ attendanceDate: SUNDAY });

      expect(state.dayType).toBe(DayType.WEEKLY_OFF);
      expect(state.status).toBe(ROSTER_NOT_MARKED);
    });

    it('calls a holiday on the weekly off a holiday', () => {
      // Both exclude the day from working days, but only one of them records
      // that a holiday was declared.
      const state = resolve({ attendanceDate: SUNDAY, isHoliday: true });

      expect(state.dayType).toBe(DayType.HOLIDAY);
    });

    it('flags an employee with no shift instead of assuming one', () => {
      // A default Sunday-off would show a rest day this employee may not have.
      const state = resolve({ attendanceDate: SUNDAY, weeklyOffDays: null });

      expect(state.dayType).toBe(DayType.WORKING);
      expect(state.noShiftAssigned).toBe(true);
    });

    it('still answers the holiday question without a shift', () => {
      const state = resolve({ weeklyOffDays: null, isHoliday: true });

      expect(state.dayType).toBe(DayType.HOLIDAY);
      expect(state.noShiftAssigned).toBe(true);
    });
  });

  describe('an approved planned absence', () => {
    it('shows as leave without the day being decided', () => {
      const state = resolve({ hasPlannedAbsence: true });

      expect(state.status).toBe(AttendanceStatus.ON_LEAVE);
      // The whole point: displayed, not written. Nothing has decided this day.
      expect(state.isMarked).toBe(false);
      expect(state.source).toBeNull();
    });

    it('loses to a stored row', () => {
      // Approved leave, but the employee turned up and the device recorded it.
      // The row is evidence; the leave is intent.
      const state = resolve({
        hasPlannedAbsence: true,
        attendance: row({ status: AttendanceStatus.PRESENT }),
      });

      expect(state.status).toBe(AttendanceStatus.PRESENT);
      expect(state.isMarked).toBe(true);
    });

    it('is not shown on a weekly off', () => {
      // Nobody consumes leave for a day they were not due at work.
      const state = resolve({
        attendanceDate: SUNDAY,
        hasPlannedAbsence: true,
      });

      expect(state.dayType).toBe(DayType.WEEKLY_OFF);
      expect(state.status).toBe(ROSTER_NOT_MARKED);
    });

    it('is not shown on a declared holiday', () => {
      const state = resolve({ isHoliday: true, hasPlannedAbsence: true });

      expect(state.dayType).toBe(DayType.HOLIDAY);
      expect(state.status).toBe(ROSTER_NOT_MARKED);
    });

    it('stays read-only on a future date', () => {
      const state = resolve({ hasPlannedAbsence: true, isFuture: true });

      expect(state.status).toBe(AttendanceStatus.ON_LEAVE);
      expect(state.isEditable).toBe(false);
    });
  });

  describe('editability', () => {
    it('allows today and the past', () => {
      expect(resolve({ isFuture: false }).isEditable).toBe(true);
    });

    it('refuses the future, row or no row', () => {
      expect(resolve({ isFuture: true }).isEditable).toBe(false);
      expect(resolve({ isFuture: true, attendance: row() }).isEditable).toBe(
        false,
      );
    });
  });
});
