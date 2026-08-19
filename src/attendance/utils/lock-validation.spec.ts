import { AttendanceStatus, DayType } from '../constants/attendance-enums.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import {
  LockBlockerReason,
  MAX_REPORTED_DATES,
  ValidatableRow,
  findLockBlockers,
} from './lock-validation.js';

const WINDOW = {
  from: toUtcDateOnly('2026-08-01'),
  to: toUtcDateOnly('2026-08-05'),
};

const IS_PAID = new Map<string, boolean>([['absence-el', true]]);

const row = (
  date: string,
  overrides: Partial<ValidatableRow> = {},
): ValidatableRow => ({
  attendanceDate: toUtcDateOnly(date),
  dayType: DayType.WORKING,
  status: AttendanceStatus.PRESENT,
  workedMinutes: 480,
  lateMinutes: 0,
  earlyExitMinutes: 0,
  overtimeMinutes: 0,
  plannedAbsenceId: null,
  hasConflict: false,
  ...overrides,
});

/** Five clean present days covering the whole window. */
const cleanMonth = (): ValidatableRow[] => [
  row('2026-08-01'),
  row('2026-08-02'),
  row('2026-08-03'),
  row('2026-08-04'),
  row('2026-08-05'),
];

const validate = (rows: ValidatableRow[], window = WINDOW) =>
  findLockBlockers({
    employees: [{ employeeId: 'EMP-001', window, rows }],
    isPaidByAbsenceId: IS_PAID,
  });

describe('findLockBlockers', () => {
  it('passes a complete, unambiguous month', () => {
    expect(validate(cleanMonth())).toEqual([]);
  });

  it('blocks on an unfinished record', () => {
    const rows = cleanMonth();

    rows[2] = row('2026-08-03', { status: AttendanceStatus.MISSING_CHECKOUT });

    expect(validate(rows)).toEqual([
      {
        employeeId: 'EMP-001',
        reason: LockBlockerReason.MISSING_CHECKOUT,
        count: 1,
        dates: ['2026-08-03'],
      },
    ]);
  });

  it('blocks on an unresolved conflict', () => {
    const rows = cleanMonth();

    rows[1] = row('2026-08-02', { hasConflict: true });

    expect(validate(rows)).toEqual([
      {
        employeeId: 'EMP-001',
        reason: LockBlockerReason.UNRESOLVED_CONFLICT,
        count: 1,
        dates: ['2026-08-02'],
      },
    ]);
  });

  it('blocks on a day with no row', () => {
    const rows = cleanMonth().filter(
      (day) =>
        day.attendanceDate.getTime() !== toUtcDateOnly('2026-08-04').getTime(),
    );

    expect(validate(rows)).toEqual([
      {
        employeeId: 'EMP-001',
        reason: LockBlockerReason.MISSING_DAY,
        count: 1,
        dates: ['2026-08-04'],
      },
    ]);
  });

  it('blocks the whole window for an employee with no rows at all', () => {
    // The close job skips employees with no shift assigned, so they arrive here
    // with an empty month rather than a wrong one.
    expect(validate([])).toEqual([
      {
        employeeId: 'EMP-001',
        reason: LockBlockerReason.MISSING_DAY,
        count: 5,
        dates: [
          '2026-08-01',
          '2026-08-02',
          '2026-08-03',
          '2026-08-04',
          '2026-08-05',
        ],
      },
    ]);
  });

  it('blocks a row whose dayType and status contradict each other', () => {
    const rows = cleanMonth();

    rows[0] = row('2026-08-01', { status: AttendanceStatus.NOT_APPLICABLE });

    expect(validate(rows)).toEqual([
      {
        employeeId: 'EMP-001',
        reason: LockBlockerReason.UNBUCKETABLE_ROW,
        count: 1,
        dates: ['2026-08-01'],
      },
    ]);
  });

  it('blocks a leave day that points at no absence', () => {
    const rows = cleanMonth();

    rows[3] = row('2026-08-04', { status: AttendanceStatus.ON_LEAVE });

    expect(validate(rows)).toEqual([
      {
        employeeId: 'EMP-001',
        reason: LockBlockerReason.UNBUCKETABLE_ROW,
        count: 1,
        dates: ['2026-08-04'],
      },
    ]);
  });

  it('blocks a row dated outside the employee’s eligible window', () => {
    // Evidence that something wrote a day for somebody already off rolls. The
    // day is not counted, and the missing-day check does not see it either.
    const rows = [...cleanMonth(), row('2026-08-06')];

    expect(validate(rows)).toEqual([
      {
        employeeId: 'EMP-001',
        reason: LockBlockerReason.ROW_OUTSIDE_ELIGIBILITY,
        count: 1,
        dates: ['2026-08-06'],
      },
    ]);
  });

  it('reports an unfinished record before the gap it also leaves nothing of', () => {
    const rows = cleanMonth();

    rows[0] = row('2026-08-01', { status: AttendanceStatus.MISSING_CHECKOUT });
    rows.splice(4, 1);

    expect(validate(rows).map((blocker) => blocker.reason)).toEqual([
      LockBlockerReason.MISSING_DAY,
      LockBlockerReason.MISSING_CHECKOUT,
    ]);
  });

  it('truncates the date list but keeps the true count', () => {
    const window = {
      from: toUtcDateOnly('2026-08-01'),
      to: toUtcDateOnly('2026-08-31'),
    };

    const [blocker] = validate([], window);

    expect(blocker.count).toBe(31);
    expect(blocker.dates).toHaveLength(MAX_REPORTED_DATES);
    expect(blocker.dates[0]).toBe('2026-08-01');
  });

  it('ignores an employee who was never on rolls during the period', () => {
    expect(
      findLockBlockers({
        employees: [{ employeeId: 'EMP-002', window: null, rows: [] }],
        isPaidByAbsenceId: IS_PAID,
      }),
    ).toEqual([]);
  });

  it('reports each employee separately', () => {
    const blockers = findLockBlockers({
      employees: [
        { employeeId: 'EMP-001', window: WINDOW, rows: cleanMonth() },
        { employeeId: 'EMP-002', window: WINDOW, rows: [] },
      ],
      isPaidByAbsenceId: IS_PAID,
    });

    expect(blockers).toHaveLength(1);
    expect(blockers[0].employeeId).toBe('EMP-002');
  });
});
