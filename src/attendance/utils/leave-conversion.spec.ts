import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import { ConvertibleRow, planLeaveConversion } from './leave-conversion.js';

const ABSENCE_ID = 'absence-1';
const TUESDAY = toUtcDateOnly('2026-08-11');

const row = (overrides: Partial<ConvertibleRow> = {}): ConvertibleRow => ({
  id: 'row-1',
  attendanceDate: TUESDAY,
  dayType: DayType.WORKING,
  status: AttendanceStatus.ABSENT,
  source: AttendanceSource.SYSTEM,
  plannedAbsenceId: null,
  ...overrides,
});

const plan = (rows: ConvertibleRow[]) =>
  planLeaveConversion({ rows, absenceId: ABSENCE_ID, leaveCode: 'EL' });

describe('planLeaveConversion', () => {
  it('converts the day the close job marked absent', () => {
    // The case the whole feature exists for: absent Tuesday, EL filed Thursday.
    const result = plan([row()]);

    expect(result.conflicted).toHaveLength(0);
    expect(result.converted).toEqual([
      {
        attendanceId: 'row-1',
        data: {
          status: AttendanceStatus.ON_LEAVE,
          plannedAbsenceId: ABSENCE_ID,
          checkIn: null,
          checkOut: null,
          workedMinutes: 0,
          lateMinutes: 0,
          earlyExitMinutes: 0,
          overtimeMinutes: 0,
        },
      },
    ]);
  });

  it('clears times and minutes left behind on the row', () => {
    // A day cannot be on leave and have hours worked against it.
    const [converted] = plan([row()]).converted;

    expect(converted.data.checkIn).toBeNull();
    expect(converted.data.checkOut).toBeNull();
    expect(converted.data.workedMinutes).toBe(0);
    expect(converted.data.overtimeMinutes).toBe(0);
  });

  it('leaves a manually marked row alone and flags it', () => {
    const result = plan([
      row({ source: AttendanceSource.MANUAL, status: AttendanceStatus.PRESENT }),
    ]);

    expect(result.converted).toHaveLength(0);
    expect(result.conflicted).toHaveLength(1);
    expect(result.conflicted[0].data.hasConflict).toBe(true);
    expect(result.conflicted[0].data.conflictNote).toContain('marked by hand');
    expect(result.conflicted[0].data.conflictNote).toContain('EL');
  });

  it('leaves a row derived from punches alone and flags it', () => {
    // On leave but showed up. A human decides whether to restore the leave.
    const result = plan([
      row({ source: AttendanceSource.DEVICE, status: AttendanceStatus.PRESENT }),
    ]);

    expect(result.converted).toHaveLength(0);
    expect(result.conflicted[0].data.conflictNote).toContain('device punches');
  });

  it('never writes a status onto a conflicted row', () => {
    const result = plan([row({ source: AttendanceSource.DEVICE })]);

    expect(Object.keys(result.conflicted[0].data)).toEqual([
      'hasConflict',
      'conflictNote',
    ]);
  });

  it('skips a weekly off', () => {
    // Not a working day, so no leave is consumed and nothing is deducted.
    const result = plan([
      row({
        dayType: DayType.WEEKLY_OFF,
        status: AttendanceStatus.NOT_APPLICABLE,
      }),
    ]);

    expect(result.converted).toHaveLength(0);
    expect(result.conflicted).toHaveLength(0);
  });

  it('skips a declared holiday', () => {
    const result = plan([
      row({
        dayType: DayType.HOLIDAY,
        status: AttendanceStatus.NOT_APPLICABLE,
      }),
    ]);

    expect(result.converted).toHaveLength(0);
    expect(result.conflicted).toHaveLength(0);
  });

  it('is a no-op for a row already charged to this absence', () => {
    // Re-running the conversion must not produce audit entries for changes that
    // did not happen.
    const result = plan([
      row({
        status: AttendanceStatus.ON_LEAVE,
        plannedAbsenceId: ABSENCE_ID,
      }),
    ]);

    expect(result.converted).toHaveLength(0);
    expect(result.conflicted).toHaveLength(0);
  });

  it('reassigns a day charged to a different absence', () => {
    // Still SYSTEM's row, so approval may correct which absence it points at.
    const result = plan([
      row({
        status: AttendanceStatus.ON_LEAVE,
        plannedAbsenceId: 'some-other-absence',
      }),
    ]);

    expect(result.converted).toHaveLength(1);
    expect(result.converted[0].data.plannedAbsenceId).toBe(ABSENCE_ID);
  });

  it('does nothing for days that have no row yet', () => {
    // Future days the close job has not reached. Creating rows here would break
    // "a row exists means the day was decided".
    expect(plan([])).toEqual({ converted: [], conflicted: [] });
  });

  it('sorts a mixed range into converted and conflicted', () => {
    const result = plan([
      row({ id: 'a' }),
      row({ id: 'b', source: AttendanceSource.DEVICE }),
      row({ id: 'c', dayType: DayType.WEEKLY_OFF }),
      row({ id: 'd' }),
    ]);

    expect(result.converted.map((c) => c.attendanceId)).toEqual(['a', 'd']);
    expect(result.conflicted.map((c) => c.attendanceId)).toEqual(['b']);
  });
});
