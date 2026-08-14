import { PrismaService } from '../prisma/prisma.service.js';
import { HolidayService } from '../holiday/holiday.service.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import {
  AttendanceDerivationService,
  DerivationSkipReason,
} from './attendance-derivation.service.js';
import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from './constants/attendance-enums.js';
import { PunchIgnoreReason } from './constants/punch-ignore-reason.constant.js';
import { toUtcDateOnly } from '../common/utils/date.js';

/**
 * A local spy rather than `jest.fn`.
 *
 * Under ESM Jest does not inject the `jest` global, and `@jest/globals` is not
 * a resolvable top-level package here, so importing it type-checks as `any` and
 * every assertion downstream goes unsafe. Twelve lines keeps the call arguments
 * genuinely typed, which is the whole point of asserting on them.
 */
type Spy<A extends unknown[], R> = ((...args: A) => R) & { calls: A[] };

function spy<A extends unknown[], R>(impl: (...args: A) => R): Spy<A, R> {
  const calls: A[] = [];

  const fn = (...args: A): R => {
    calls.push(args);
    return impl(...args);
  };

  return Object.assign(fn, { calls });
}

const ist = (dateTime: string) => new Date(`${dateTime}+05:30`);

const DATE = toUtcDateOnly('2026-08-13'); // a Thursday
const EMPLOYEE_ID = 'emp-1';

const SHIFT = {
  id: 'shift-day',
  startMinutes: 540,
  endMinutes: 1080,
  breakMinutes: 60,
  graceMinutes: 10,
  weeklyOffDays: [0],
};

const EMPLOYEE = {
  id: EMPLOYEE_ID,
  dateOfJoining: toUtcDateOnly('2020-01-01'),
  lastWorkingDay: null as Date | null,
  shift: SHIFT as typeof SHIFT | null,
};

const punch = (id: string, dateTime: string) => ({
  id,
  employeeId: EMPLOYEE_ID,
  punchedAt: ist(dateTime),
  attendanceDate: DATE,
});

const FULL_DAY = [
  punch('p1', '2026-08-13T09:02:00'),
  punch('p2', '2026-08-13T18:30:00'),
];

type Fields = Record<string, unknown>;
type UpsertArgs = { where: Fields; create: Fields; update: Fields };
type UpdateArgs = { where: Fields; data: Fields };
type UpdateManyArgs = { where: { id: { in: string[] } }; data: Fields };
type FindManyArgs = { where: { OR: unknown[] } };

type ExistingRow = {
  employeeId: string;
  attendanceDate: Date;
  source: AttendanceSource;
  status: string;
};

/**
 * Writes are collected as Prisma promises and handed to `$transaction` in one
 * go, so the stubs return markers and the assertions read the call arguments.
 */
function makeHarness(
  overrides: {
    employees?: (typeof EMPLOYEE)[];
    punches?: ReturnType<typeof punch>[];
    existing?: ExistingRow[];
    holidays?: string[];
  } = {},
) {
  const upsert = spy((args: UpsertArgs) => ({ op: 'upsert', args }));
  const update = spy((args: UpdateArgs) => ({ op: 'update', args }));
  const updateMany = spy((args: UpdateManyArgs) => ({
    op: 'updateMany',
    args,
  }));
  const transaction = spy((ops: unknown[], options?: Fields) =>
    Promise.resolve([ops, options]),
  );

  const employeeFindMany = spy(() =>
    Promise.resolve(overrides.employees ?? [EMPLOYEE]),
  );
  const punchFindMany = spy((_args: FindManyArgs) =>
    Promise.resolve(overrides.punches ?? FULL_DAY),
  );

  const prisma = {
    employee: {
      findMany: employeeFindMany,
      findUnique: spy(() => Promise.resolve({ id: EMPLOYEE_ID })),
    },
    attendancePunch: { findMany: punchFindMany, updateMany },
    attendance: {
      findMany: spy(() => Promise.resolve(overrides.existing ?? [])),
      upsert,
      update,
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  const holidayService = {
    findDateKeysIn: spy(() =>
      Promise.resolve(new Set(overrides.holidays ?? [])),
    ),
  } as unknown as HolidayService;

  const service = new AttendanceDerivationService(
    prisma,
    new AttendancePolicyService(),
    holidayService,
  );

  return {
    service,
    upsert,
    update,
    updateMany,
    transaction,
    employeeFindMany,
    punchFindMany,
  };
}

const derivePair = [{ employeeId: EMPLOYEE_ID, attendanceDate: DATE }];

const existingRow = (source: AttendanceSource): ExistingRow => ({
  employeeId: EMPLOYEE_ID,
  attendanceDate: DATE,
  source,
  status: AttendanceStatus.ABSENT,
});

describe('AttendanceDerivationService', () => {
  describe('source precedence — the behaviour every later phase assumes', () => {
    /**
     * PRD §4.2. HR marks somebody absent at 11:00; he turns up and punches at
     * 14:00. The punch is stored, the row is not modified, the contradiction is
     * flagged for a human.
     */
    it('does not touch a MANUAL row when a device punch lands on it', async () => {
      const { service, upsert, update } = makeHarness({
        existing: [existingRow(AttendanceSource.MANUAL)],
      });

      const summary = await service.deriveDays(derivePair);

      expect(upsert.calls).toHaveLength(0);
      expect(update.calls).toHaveLength(1);

      const { data } = update.calls[0][0];

      // Exactly two fields. Anything else here would be the row being edited.
      expect(Object.keys(data).sort()).toEqual(['conflictNote', 'hasConflict']);
      expect(data.hasConflict).toBe(true);
      expect(data.conflictNote).toContain('ABSENT');

      expect(summary.conflicts).toBe(1);
      expect(summary.derived).toBe(0);
    });

    it('still marks the conflicting punches processed', async () => {
      // Otherwise the derive endpoint picks them up again on every run.
      const { service, updateMany } = makeHarness({
        existing: [existingRow(AttendanceSource.MANUAL)],
      });

      await service.deriveDays(derivePair);

      const applied = updateMany.calls[0][0];

      expect(applied.where.id.in.sort()).toEqual(['p1', 'p2']);
      expect(applied.data.isProcessed).toBe(true);
    });

    it.each([
      ['no row at all', null],
      ['a SYSTEM row', AttendanceSource.SYSTEM],
      ['an earlier DEVICE row', AttendanceSource.DEVICE],
    ])('writes over %s', async (_label, source) => {
      const { service, upsert, update } = makeHarness({
        existing: source ? [existingRow(source)] : [],
      });

      const summary = await service.deriveDays(derivePair);

      expect(upsert.calls).toHaveLength(1);
      expect(update.calls).toHaveLength(0);
      expect(summary.conflicts).toBe(0);
      expect(summary.derived).toBe(1);
    });

    it('never clears fields another write path owns', async () => {
      const { service, upsert } = makeHarness();

      await service.deriveDays(derivePair);

      const { update } = upsert.calls[0][0];

      // `remark`, `markedById` and `plannedAbsenceId` belong to Phases 7 and 8.
      // Listing them here — even as null — would wipe them on every re-derive.
      expect(update).not.toHaveProperty('remark');
      expect(update).not.toHaveProperty('markedById');
      expect(update).not.toHaveProperty('plannedAbsenceId');
    });
  });

  describe('the derived row', () => {
    it('writes DEVICE source and the shift it was judged against', async () => {
      const { service, upsert } = makeHarness();

      await service.deriveDays(derivePair);

      const { create } = upsert.calls[0][0];

      expect(create.source).toBe(AttendanceSource.DEVICE);
      expect(create.shiftId).toBe(SHIFT.id);
      expect(create.employeeId).toBe(EMPLOYEE_ID);
      expect(create.attendanceDate).toEqual(DATE);
      expect(create.status).toBe(AttendanceStatus.PRESENT);
      expect(create.dayType).toBe(DayType.WORKING);
      expect(create.checkIn).toEqual(ist('2026-08-13T09:02:00'));
      expect(create.checkOut).toEqual(ist('2026-08-13T18:30:00'));
    });

    it('marks the day a holiday when the date is declared', async () => {
      const { service, upsert } = makeHarness({ holidays: ['2026-08-13'] });

      await service.deriveDays(derivePair);

      const { create } = upsert.calls[0][0];

      expect(create.dayType).toBe(DayType.HOLIDAY);
      expect(create.compensationType).not.toBeNull();
    });
  });

  describe('punch flags', () => {
    it('ignores the middle punches and keeps the outer pair', async () => {
      const { service, updateMany } = makeHarness({
        punches: [
          punch('first', '2026-08-13T09:02:00'),
          punch('lunch', '2026-08-13T13:15:00'),
          punch('back', '2026-08-13T14:05:00'),
          punch('last', '2026-08-13T18:30:00'),
        ],
      });

      await service.deriveDays(derivePair);

      const [applied, midDay] = updateMany.calls.map((call) => call[0]);

      expect(applied.where.id.in.sort()).toEqual(['first', 'last']);
      // Cleared, not merely left alone — a punch that stops being mid-day has
      // to come back into the arithmetic.
      expect(applied.data).toEqual({
        isProcessed: true,
        isIgnored: false,
        ignoreReason: null,
      });

      expect(midDay.where.id.in.sort()).toEqual(['back', 'lunch']);
      expect(midDay.data).toEqual({
        isProcessed: true,
        isIgnored: true,
        ignoreReason: PunchIgnoreReason.MID_DAY_PUNCH,
      });
    });

    it('re-reads its own ignored punches so the verdict can reverse', async () => {
      const { service, punchFindMany } = makeHarness();

      await service.deriveDays(derivePair);

      const { where } = punchFindMany.calls[0][0];

      // Not `isIgnored: false` alone, which would freeze the first run's set.
      expect(where.OR).toEqual([
        { isIgnored: false },
        { ignoreReason: { in: [PunchIgnoreReason.MID_DAY_PUNCH] } },
      ]);
    });
  });

  describe('days it refuses to derive', () => {
    const expectSkip = async (
      harness: ReturnType<typeof makeHarness>,
      reason: string,
    ) => {
      const summary = await harness.service.deriveDays(derivePair);

      expect(harness.upsert.calls).toHaveLength(0);
      expect(harness.update.calls).toHaveLength(0);
      expect(summary.skipped).toEqual([
        { employeeId: EMPLOYEE_ID, attendanceDate: '2026-08-13', reason },
      ]);
    };

    // PRD §9 case 13. An assumed 9-to-6 would produce plausible-looking wrong
    // numbers, which is worse than refusing to answer.
    it('refuses when the employee has no shift', async () => {
      await expectSkip(
        makeHarness({ employees: [{ ...EMPLOYEE, shift: null }] }),
        DerivationSkipReason.NO_SHIFT_ASSIGNED,
      );
    });

    it('refuses for a day the employee was not on rolls', async () => {
      await expectSkip(
        makeHarness({
          employees: [
            { ...EMPLOYEE, lastWorkingDay: toUtcDateOnly('2026-07-31') },
          ],
        }),
        DerivationSkipReason.NOT_ON_ROLLS,
      );
    });

    it('refuses for an employee it cannot find', async () => {
      await expectSkip(
        makeHarness({ employees: [] }),
        DerivationSkipReason.UNKNOWN_EMPLOYEE,
      );
    });

    // Deciding a punchless day was an absence needs holidays, weekly offs and
    // leave weighed first — that is the close job's call, not derivation's.
    it('never invents a row for a day with no punches', async () => {
      await expectSkip(
        makeHarness({ punches: [] }),
        DerivationSkipReason.NO_PUNCHES,
      );
    });
  });

  describe('idempotency', () => {
    it('produces an identical write plan on a second run', async () => {
      const first = makeHarness();
      const second = makeHarness();

      const summaryOne = await first.service.deriveDays(derivePair);
      const summaryTwo = await second.service.deriveDays(derivePair);

      expect(second.upsert.calls).toEqual(first.upsert.calls);
      expect(second.updateMany.calls).toEqual(first.updateMany.calls);
      expect(summaryTwo).toEqual(summaryOne);
    });

    it('collapses a day submitted many times into one derivation', async () => {
      const { service, upsert } = makeHarness();

      // What ingestion hands over for four punches on the same day.
      const summary = await service.deriveDays([
        { employeeId: EMPLOYEE_ID, attendanceDate: DATE },
        { employeeId: EMPLOYEE_ID, attendanceDate: DATE },
        { employeeId: EMPLOYEE_ID, attendanceDate: new Date(DATE) },
        { employeeId: EMPLOYEE_ID, attendanceDate: ist('2026-08-13T14:00:00') },
      ]);

      expect(upsert.calls).toHaveLength(1);
      expect(summary.derived).toBe(1);
    });

    it('does nothing at all for an empty batch', async () => {
      const { service, transaction, employeeFindMany } = makeHarness();

      const summary = await service.deriveDays([]);

      expect(transaction.calls).toHaveLength(0);
      expect(employeeFindMany.calls).toHaveLength(0);
      expect(summary).toEqual({
        derived: 0,
        rowsCreated: 0,
        rowsUpdated: 0,
        conflicts: 0,
        skipped: [],
      });
    });
  });

  describe('writes', () => {
    it('sends every write through one transaction with the Neon timeouts', async () => {
      const { service, transaction } = makeHarness();

      await service.deriveDays(derivePair);

      expect(transaction.calls).toHaveLength(1);

      const [ops, options] = transaction.calls[0];

      expect(ops).toHaveLength(2); // the upsert, plus the applied-punch flags
      expect(options).toEqual({ timeout: 15000, maxWait: 10000 });
    });
  });

  describe('derive()', () => {
    it('rejects a range that runs backwards', async () => {
      const { service } = makeHarness();

      await expect(
        service.derive({ from: '2026-08-20', to: '2026-08-13' }),
      ).rejects.toThrow('`from` must not be later than `to`');
    });

    it('rejects a date the calendar does not have', async () => {
      const { service } = makeHarness();

      await expect(
        service.derive({ from: '2026-02-30', to: '2026-03-01' }),
      ).rejects.toThrow(/Invalid calendar date/);
    });
  });
});
