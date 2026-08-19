import { AttendanceStatus, DayType } from '../constants/attendance-enums.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import {
  DayBucket,
  SummaryRow,
  bucketDay,
  checkReconciliation,
  countDaysInclusive,
  eligibleWindow,
  splitByWindow,
  summariseEmployee,
} from './monthly-summary.js';

const AUGUST = {
  startDate: toUtcDateOnly('2026-08-01'),
  endDate: toUtcDateOnly('2026-08-31'),
};

const PAID = 'absence-el';
const UNPAID = 'absence-lwp';

const IS_PAID = new Map<string, boolean>([
  [PAID, true],
  [UNPAID, false],
]);

const day = (
  date: string,
  overrides: Partial<SummaryRow> = {},
): SummaryRow => ({
  attendanceDate: toUtcDateOnly(date),
  dayType: DayType.WORKING,
  status: AttendanceStatus.PRESENT,
  workedMinutes: 480,
  lateMinutes: 0,
  earlyExitMinutes: 0,
  overtimeMinutes: 0,
  plannedAbsenceId: null,
  ...overrides,
});

/**
 * PRD §4.4's worked example, built day by day: August 2026, Sundays off, Aug 15
 * declared a holiday and worked, Aug 7 on EL, Aug 12 absent, Aug 20 a half day.
 */
function augustExample(): SummaryRow[] {
  const sundays = [
    '2026-08-02',
    '2026-08-09',
    '2026-08-16',
    '2026-08-23',
    '2026-08-30',
  ];
  const rows: SummaryRow[] = [];

  for (let date = 1; date <= 31; date += 1) {
    const key = `2026-08-${String(date).padStart(2, '0')}`;

    if (sundays.includes(key)) {
      rows.push(
        day(key, {
          dayType: DayType.WEEKLY_OFF,
          status: AttendanceStatus.NOT_APPLICABLE,
          workedMinutes: 0,
        }),
      );
      continue;
    }

    if (key === '2026-08-15') {
      // Declared holiday, and the employee worked it — the case the overlay
      // exists for.
      rows.push(
        day(key, {
          dayType: DayType.HOLIDAY,
          status: AttendanceStatus.PRESENT,
          overtimeMinutes: 60,
        }),
      );
      continue;
    }

    if (key === '2026-08-07') {
      rows.push(
        day(key, {
          status: AttendanceStatus.ON_LEAVE,
          plannedAbsenceId: PAID,
          workedMinutes: 0,
        }),
      );
      continue;
    }

    if (key === '2026-08-12') {
      rows.push(
        day(key, { status: AttendanceStatus.ABSENT, workedMinutes: 0 }),
      );
      continue;
    }

    if (key === '2026-08-20') {
      rows.push(
        day(key, { status: AttendanceStatus.HALF_DAY, workedMinutes: 240 }),
      );
      continue;
    }

    rows.push(day(key));
  }

  return rows;
}

const summarise = (rows: SummaryRow[], eligibleDays = 31) =>
  summariseEmployee({ eligibleDays, rows, isPaidByAbsenceId: IS_PAID });

describe('eligibleWindow', () => {
  it('is the whole period for somebody on rolls throughout it', () => {
    const window = eligibleWindow(AUGUST, {
      dateOfJoining: toUtcDateOnly('2020-01-01'),
      lastWorkingDay: null,
    });

    expect(window).toEqual({
      from: toUtcDateOnly('2026-08-01'),
      to: toUtcDateOnly('2026-08-31'),
    });
  });

  it('starts at the joining date for a mid-month joiner', () => {
    // The reason `eligibleDays` exists: payroll prorates against 12, not 31.
    const window = eligibleWindow(AUGUST, {
      dateOfJoining: toUtcDateOnly('2026-08-20'),
      lastWorkingDay: null,
    });

    expect(window).toEqual({
      from: toUtcDateOnly('2026-08-20'),
      to: toUtcDateOnly('2026-08-31'),
    });
    expect(countDaysInclusive(window!.from, window!.to)).toBe(12);
  });

  it('ends on the last working day for a mid-month exit, inclusive', () => {
    const window = eligibleWindow(AUGUST, {
      dateOfJoining: toUtcDateOnly('2020-01-01'),
      lastWorkingDay: toUtcDateOnly('2026-08-10'),
    });

    expect(countDaysInclusive(window!.from, window!.to)).toBe(10);
  });

  it('is null for somebody who joined after the period ended', () => {
    expect(
      eligibleWindow(AUGUST, {
        dateOfJoining: toUtcDateOnly('2026-09-01'),
        lastWorkingDay: null,
      }),
    ).toBeNull();
  });

  it('is null for somebody who left before the period began', () => {
    expect(
      eligibleWindow(AUGUST, {
        dateOfJoining: toUtcDateOnly('2020-01-01'),
        lastWorkingDay: toUtcDateOnly('2026-07-31'),
      }),
    ).toBeNull();
  });
});

describe('countDaysInclusive', () => {
  it('counts both ends', () => {
    expect(
      countDaysInclusive(
        toUtcDateOnly('2026-08-01'),
        toUtcDateOnly('2026-08-31'),
      ),
    ).toBe(31);
  });

  it('counts a single day as one', () => {
    const date = toUtcDateOnly('2026-08-05');

    expect(countDaysInclusive(date, date)).toBe(1);
  });

  it('is zero for a reversed range rather than negative', () => {
    expect(
      countDaysInclusive(
        toUtcDateOnly('2026-08-31'),
        toUtcDateOnly('2026-08-01'),
      ),
    ).toBe(0);
  });
});

describe('bucketDay', () => {
  it('calls a worked holiday a holiday', () => {
    // PRD §4.1: dayType is what the day was, status is what happened on it.
    expect(
      bucketDay(
        {
          dayType: DayType.HOLIDAY,
          status: AttendanceStatus.PRESENT,
          plannedAbsenceId: null,
        },
        IS_PAID,
      ),
    ).toBe(DayBucket.HOLIDAY);
  });

  it('calls a worked weekly off a weekly off', () => {
    expect(
      bucketDay(
        {
          dayType: DayType.WEEKLY_OFF,
          status: AttendanceStatus.PRESENT,
          plannedAbsenceId: null,
        },
        IS_PAID,
      ),
    ).toBe(DayBucket.WEEKLY_OFF);
  });

  it('splits leave on the leave type being paid', () => {
    const leave = (id: string) =>
      bucketDay(
        {
          dayType: DayType.WORKING,
          status: AttendanceStatus.ON_LEAVE,
          plannedAbsenceId: id,
        },
        IS_PAID,
      );

    expect(leave(PAID)).toBe(DayBucket.PAID_LEAVE);
    expect(leave(UNPAID)).toBe(DayBucket.UNPAID_LEAVE);
  });

  it('refuses to guess when a leave day points at no absence', () => {
    expect(
      bucketDay(
        {
          dayType: DayType.WORKING,
          status: AttendanceStatus.ON_LEAVE,
          plannedAbsenceId: null,
        },
        IS_PAID,
      ),
    ).toBe(DayBucket.UNBUCKETABLE);
  });

  it('refuses a working day marked NOT_APPLICABLE', () => {
    expect(
      bucketDay(
        {
          dayType: DayType.WORKING,
          status: AttendanceStatus.NOT_APPLICABLE,
          plannedAbsenceId: null,
        },
        IS_PAID,
      ),
    ).toBe(DayBucket.UNBUCKETABLE);
  });

  it('refuses an unfinished record', () => {
    expect(
      bucketDay(
        {
          dayType: DayType.WORKING,
          status: AttendanceStatus.MISSING_CHECKOUT,
          plannedAbsenceId: null,
        },
        IS_PAID,
      ),
    ).toBe(DayBucket.UNBUCKETABLE);
  });
});

describe('splitByWindow', () => {
  it('separates rows the employee was not on rolls for', () => {
    const window = {
      from: toUtcDateOnly('2026-08-01'),
      to: toUtcDateOnly('2026-08-10'),
    };
    const { inWindow, outOfWindow } = splitByWindow(
      [day('2026-08-01'), day('2026-08-10'), day('2026-08-11')],
      window,
    );

    expect(inWindow).toHaveLength(2);
    expect(outOfWindow).toHaveLength(1);
    expect(outOfWindow[0].attendanceDate).toEqual(toUtcDateOnly('2026-08-11'));
  });
});

describe('summariseEmployee — PRD §4.4 worked example', () => {
  const counts = summarise(augustExample());

  it('produces the PRD’s bucket figures', () => {
    expect(counts).toMatchObject({
      presentDays: 22,
      halfDays: 1,
      absentDays: 1,
      paidLeaveDays: 1,
      unpaidLeaveDays: 0,
      holidayCount: 1,
      weeklyOffCount: 5,
    });
  });

  it('reconciles to 31', () => {
    expect(checkReconciliation(counts)).toEqual({
      ok: true,
      sum: 31,
      eligibleDays: 31,
    });
  });

  it('records the worked holiday as an overlay, not a present day', () => {
    // The whole point of §4.4's exclusion: counting it twice makes the sum 32
    // and pays for a day that does not exist.
    expect(counts.holidayWorkedDays).toBe(1);
    expect(counts.presentDays).toBe(22);
    expect(counts.holidayOvertimeMinutes).toBe(60);
    expect(counts.normalOvertimeMinutes).toBe(0);
  });
});

describe('summariseEmployee', () => {
  it('splits overtime three ways by the day it was earned on', () => {
    const counts = summarise(
      [
        day('2026-08-03', { overtimeMinutes: 30 }),
        day('2026-08-15', {
          dayType: DayType.HOLIDAY,
          overtimeMinutes: 90,
        }),
        day('2026-08-16', {
          dayType: DayType.WEEKLY_OFF,
          overtimeMinutes: 45,
        }),
      ],
      3,
    );

    expect(counts.normalOvertimeMinutes).toBe(30);
    expect(counts.holidayOvertimeMinutes).toBe(90);
    expect(counts.weeklyOffOvertimeMinutes).toBe(45);
  });

  it('totals late and early-exit minutes over the period', () => {
    const counts = summarise(
      [
        day('2026-08-03', { lateMinutes: 20, earlyExitMinutes: 15 }),
        day('2026-08-04', { lateMinutes: 5, earlyExitMinutes: 30 }),
      ],
      2,
    );

    expect(counts.totalLateMinutes).toBe(25);
    expect(counts.totalEarlyExitMinutes).toBe(45);
    expect(counts.totalWorkedMinutes).toBe(960);
  });

  it('counts a half day as one day, not half of one', () => {
    const counts = summarise(
      [day('2026-08-20', { status: AttendanceStatus.HALF_DAY })],
      1,
    );

    expect(counts.halfDays).toBe(1);
    expect(checkReconciliation(counts).ok).toBe(true);
  });

  it('reconciles for a mid-month joiner against their own eligible days', () => {
    const rows = [
      day('2026-08-20'),
      day('2026-08-21'),
      day('2026-08-22', { status: AttendanceStatus.ABSENT, workedMinutes: 0 }),
    ];

    expect(checkReconciliation(summarise(rows, 3))).toEqual({
      ok: true,
      sum: 3,
      eligibleDays: 3,
    });
  });

  it('fails reconciliation when a day has no row', () => {
    // The bug this invariant exists to catch: a night the close job did not run
    // leaves a gap that every individual figure looks fine despite.
    const result = checkReconciliation(summarise([day('2026-08-03')], 2));

    expect(result).toEqual({ ok: false, sum: 1, eligibleDays: 2 });
  });

  it('fails reconciliation when a row cannot be bucketed', () => {
    const rows = [
      day('2026-08-03'),
      day('2026-08-04', { status: AttendanceStatus.MISSING_CHECKOUT }),
    ];

    expect(checkReconciliation(summarise(rows, 2))).toEqual({
      ok: false,
      sum: 1,
      eligibleDays: 2,
    });
  });
});
