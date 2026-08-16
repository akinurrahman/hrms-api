import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';
import { RevertibleRow, planLeaveReversion } from './leave-reversion.js';

const ABSENCE_ID = 'absence-1';

const row = (overrides: Partial<RevertibleRow> = {}): RevertibleRow => ({
  id: 'row-1',
  dayType: DayType.WORKING,
  status: AttendanceStatus.ON_LEAVE,
  source: AttendanceSource.SYSTEM,
  plannedAbsenceId: ABSENCE_ID,
  ...overrides,
});

const plan = (rows: RevertibleRow[]) =>
  planLeaveReversion({ rows, absenceId: ABSENCE_ID, leaveCode: 'EL' });

describe('planLeaveReversion', () => {
  it('takes a converted day back to absent', () => {
    // The case the feature exists for: EL approved on Thursday flipped Tuesday
    // to ON_LEAVE, EL withdrawn on Friday.
    expect(plan([row()])).toEqual({
      conflicted: [],
      reverted: [
        {
          attendanceId: 'row-1',
          data: {
            status: AttendanceStatus.ABSENT,
            plannedAbsenceId: null,
          },
        },
      ],
    });
  });

  it('clears the link to the cancelled absence', () => {
    // A day pointing at a cancelled record reads as authorised right up until
    // somebody opens it.
    const [reverted] = plan([row()]).reverted;

    expect(reverted.data.plannedAbsenceId).toBeNull();
  });

  it('leaves a day charged to a different absence alone', () => {
    // Cancelling this leave says nothing about a day another leave paid for.
    expect(plan([row({ plannedAbsenceId: 'absence-other' })])).toEqual({
      reverted: [],
      conflicted: [],
    });
  });

  it('leaves an unlinked day alone', () => {
    // The days the conversion refused to touch. Cancelling must not write to
    // them a second time.
    expect(
      plan([
        row({
          plannedAbsenceId: null,
          status: AttendanceStatus.PRESENT,
          source: AttendanceSource.DEVICE,
        }),
      ]),
    ).toEqual({ reverted: [], conflicted: [] });
  });

  it('flags a hand-marked day rather than reverting it', () => {
    const result = plan([row({ source: AttendanceSource.MANUAL })]);

    expect(result.reverted).toHaveLength(0);
    expect(result.conflicted).toHaveLength(1);
    expect(result.conflicted[0].data.hasConflict).toBe(true);
    expect(result.conflicted[0].data.conflictNote).toContain('marked by hand');
    expect(result.conflicted[0].data.conflictNote).toContain('EL');
  });

  it('flags a day recorded from punches rather than reverting it', () => {
    const result = plan([row({ source: AttendanceSource.DEVICE })]);

    expect(result.reverted).toHaveLength(0);
    expect(result.conflicted[0].data.conflictNote).toContain('device punches');
  });

  it('never writes a status onto a conflicted row', () => {
    const result = plan([row({ source: AttendanceSource.DEVICE })]);

    expect(Object.keys(result.conflicted[0].data)).toEqual([
      'hasConflict',
      'conflictNote',
    ]);
  });

  it('returns a rest day to NOT_APPLICABLE, not absent', () => {
    // The employee was not due at work either way. ABSENT here would invent a
    // deduction out of a cancellation.
    const [reverted] = plan([row({ dayType: DayType.WEEKLY_OFF })]).reverted;

    expect(reverted.data.status).toBe(AttendanceStatus.NOT_APPLICABLE);
  });

  it('returns a holiday to NOT_APPLICABLE', () => {
    const [reverted] = plan([row({ dayType: DayType.HOLIDAY })]).reverted;

    expect(reverted.data.status).toBe(AttendanceStatus.NOT_APPLICABLE);
  });

  it('is a no-op when a second cancellation finds nothing left linked', () => {
    // Idempotency: the first cancellation cleared the link.
    expect(plan([row({ plannedAbsenceId: null })])).toEqual({
      reverted: [],
      conflicted: [],
    });
  });

  it('does nothing for days that have no row', () => {
    expect(plan([])).toEqual({ reverted: [], conflicted: [] });
  });

  it('sorts a mixed range into reverted and conflicted', () => {
    const result = plan([
      row({ id: 'a' }),
      row({ id: 'b', source: AttendanceSource.DEVICE }),
      row({ id: 'c', plannedAbsenceId: null }),
      row({ id: 'd' }),
    ]);

    expect(result.reverted.map((r) => r.attendanceId)).toEqual(['a', 'd']);
    expect(result.conflicted.map((c) => c.attendanceId)).toEqual(['b']);
  });
});
