import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import {
  ClosableRow,
  CloseDayInput,
  CloseSkipReason,
  planCloseDay,
} from './close-day.js';

const TUESDAY = toUtcDateOnly('2026-08-11');
const SUNDAY = toUtcDateOnly('2026-08-16');
const LEAVE = { id: 'absence-1' };

const SHIFT = { id: 'shift-day', weeklyOffDays: [0] };

const ist = (dateTime: string) => new Date(`${dateTime}+05:30`);

const row = (overrides: Partial<ClosableRow> = {}): ClosableRow => ({
  id: 'row-1',
  source: AttendanceSource.DEVICE,
  status: AttendanceStatus.PRESENT,
  checkIn: ist('2026-08-11T09:00'),
  checkOut: ist('2026-08-11T18:00'),
  hasConflict: false,
  plannedAbsenceId: null,
  ...overrides,
});

const plan = (overrides: Partial<CloseDayInput> = {}) =>
  planCloseDay({
    attendanceDate: TUESDAY,
    shift: SHIFT,
    isHoliday: false,
    existing: null,
    leave: null,
    ...overrides,
  });

describe('planCloseDay', () => {
  describe('no shift assigned', () => {
    it('skips and reports rather than assuming one', () => {
      // PRD §9 case 13. A default 9-to-6 would produce plausible wrong numbers.
      expect(plan({ shift: null })).toEqual({
        kind: 'SKIP',
        reason: CloseSkipReason.NO_SHIFT_ASSIGNED,
      });
    });

    it('skips even when a row already exists', () => {
      // The shift is missing, so nothing about the day can be reasoned about —
      // including whether the existing row contradicts anything.
      expect(plan({ shift: null, existing: row(), leave: LEAVE })).toEqual({
        kind: 'SKIP',
        reason: CloseSkipReason.NO_SHIFT_ASSIGNED,
      });
    });
  });

  describe('no row yet', () => {
    it('marks a plain working day absent', () => {
      const action = plan();

      expect(action.kind).toBe('CREATE');
      if (action.kind !== 'CREATE') return;

      expect(action.data).toEqual({
        shiftId: 'shift-day',
        dayType: DayType.WORKING,
        status: AttendanceStatus.ABSENT,
        source: AttendanceSource.SYSTEM,
        plannedAbsenceId: null,
        checkIn: null,
        checkOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    it('writes SYSTEM so a late punch can still overwrite it', () => {
      const action = plan();

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.source).toBe(AttendanceSource.SYSTEM);
    });

    it('marks a weekly off NOT_APPLICABLE, not absent', () => {
      const action = plan({ attendanceDate: SUNDAY });

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.dayType).toBe(DayType.WEEKLY_OFF);
      expect(action.data.status).toBe(AttendanceStatus.NOT_APPLICABLE);
    });

    it('marks a declared holiday NOT_APPLICABLE', () => {
      const action = plan({ isHoliday: true });

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.dayType).toBe(DayType.HOLIDAY);
      expect(action.data.status).toBe(AttendanceStatus.NOT_APPLICABLE);
    });

    it('calls a holiday falling on a Sunday a HOLIDAY', () => {
      // Holiday beats weekly off: both are non-working, but only one records
      // that a holiday was declared.
      const action = plan({ attendanceDate: SUNDAY, isHoliday: true });

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.dayType).toBe(DayType.HOLIDAY);
    });

    it('marks approved leave ON_LEAVE and links the absence', () => {
      const action = plan({ leave: LEAVE });

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.status).toBe(AttendanceStatus.ON_LEAVE);
      expect(action.data.plannedAbsenceId).toBe('absence-1');
    });

    it('consumes no leave on a weekly off', () => {
      // The employee was not due at work, so no balance is spent and the row
      // must not point at the absence.
      const action = plan({ attendanceDate: SUNDAY, leave: LEAVE });

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.status).toBe(AttendanceStatus.NOT_APPLICABLE);
      expect(action.data.plannedAbsenceId).toBeNull();
    });

    it('consumes no leave on a holiday', () => {
      const action = plan({ isHoliday: true, leave: LEAVE });

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.status).toBe(AttendanceStatus.NOT_APPLICABLE);
      expect(action.data.plannedAbsenceId).toBeNull();
    });

    it('never invents times or minutes', () => {
      const action = plan({ leave: LEAVE });

      if (action.kind !== 'CREATE') throw new Error('expected CREATE');
      expect(action.data.checkIn).toBeNull();
      expect(action.data.workedMinutes).toBe(0);
      expect(action.data.overtimeMinutes).toBe(0);
    });
  });

  describe('a row already exists', () => {
    it('leaves a complete device row alone', () => {
      expect(plan({ existing: row() })).toEqual({ kind: 'NOOP' });
    });

    it('leaves a manually marked absence alone', () => {
      // The single most important behaviour in the module: SYSTEM never
      // overrides a human.
      const existing = row({
        source: AttendanceSource.MANUAL,
        status: AttendanceStatus.ABSENT,
        checkIn: null,
        checkOut: null,
      });

      expect(plan({ existing })).toEqual({ kind: 'NOOP' });
    });

    it('flags a punched day that approved leave covers', () => {
      // PRD §9 case 8 — on leave but showed up.
      const action = plan({ existing: row(), leave: LEAVE });

      expect(action.kind).toBe('FLAG_CONFLICT');
      if (action.kind !== 'FLAG_CONFLICT') return;

      expect(action.data.hasConflict).toBe(true);
      expect(action.data.conflictNote).toContain('PRESENT');
    });

    it('does not re-flag a row already flagged', () => {
      // The idempotency case. A second run must produce no write and no audit
      // entry for a contradiction that is already on the record.
      const existing = row({ hasConflict: true });

      expect(plan({ existing, leave: LEAVE })).toEqual({ kind: 'NOOP' });
    });

    it('does not flag a row already charged to leave', () => {
      const existing = row({
        status: AttendanceStatus.ON_LEAVE,
        plannedAbsenceId: 'absence-1',
        checkIn: null,
        checkOut: null,
      });

      expect(plan({ existing, leave: LEAVE })).toEqual({ kind: 'NOOP' });
    });

    it('does not flag a row charged to some other absence', () => {
      // Written because of leave, not in spite of it. Which absence it points at
      // is the leave module's business, not the close job's.
      const existing = row({
        status: AttendanceStatus.ON_LEAVE,
        plannedAbsenceId: 'absence-other',
        checkIn: null,
        checkOut: null,
      });

      expect(plan({ existing, leave: LEAVE })).toEqual({ kind: 'NOOP' });
    });

    it('marks a device row with no check-out MISSING_CHECKOUT', () => {
      const existing = row({ checkOut: null });
      const action = plan({ existing });

      expect(action).toEqual({
        kind: 'FIX_MISSING_CHECKOUT',
        data: { status: AttendanceStatus.MISSING_CHECKOUT },
      });
    });

    it('leaves a hand-typed row with no check-out alone', () => {
      // A human typed the times and left the status where they left it.
      // Second-guessing that is a decision, not an observation.
      const existing = row({
        source: AttendanceSource.MANUAL,
        checkOut: null,
      });

      expect(plan({ existing })).toEqual({ kind: 'NOOP' });
    });

    it('does not re-apply MISSING_CHECKOUT', () => {
      const existing = row({
        checkOut: null,
        status: AttendanceStatus.MISSING_CHECKOUT,
      });

      expect(plan({ existing })).toEqual({ kind: 'NOOP' });
    });

    it('does nothing for a row with no check-in at all', () => {
      // An absence, not an incomplete day.
      const existing = row({
        source: AttendanceSource.SYSTEM,
        status: AttendanceStatus.ABSENT,
        checkIn: null,
        checkOut: null,
      });

      expect(plan({ existing })).toEqual({ kind: 'NOOP' });
    });

    it('prefers the conflict when a row is both contradicted and incomplete', () => {
      // The contradiction is the more urgent problem and the one HR acts on.
      const existing = row({ checkOut: null });
      const action = plan({ existing, leave: LEAVE });

      expect(action.kind).toBe('FLAG_CONFLICT');
    });

    it('never returns a CREATE when a row exists', () => {
      // A row means the day was decided. Overwriting it is precedence's job to
      // refuse, and it should never get the chance.
      const inputs: Partial<CloseDayInput>[] = [
        { existing: row() },
        { existing: row(), leave: LEAVE },
        { existing: row({ checkOut: null }) },
        { existing: row(), attendanceDate: SUNDAY },
        { existing: row(), isHoliday: true },
      ];

      for (const input of inputs) {
        expect(plan(input).kind).not.toBe('CREATE');
      }
    });
  });
});
