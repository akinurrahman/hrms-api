import { PrismaService } from '../prisma/prisma.service.js';
import { HolidayService } from '../holiday/holiday.service.js';
import { toUtcDateOnly } from '../common/utils/date.js';
import { AttendanceAuditService } from './attendance-audit.service.js';
import { AttendanceCloseService } from './attendance-close.service.js';
import {
  AttendanceDerivationService,
  DerivationSummary,
} from './attendance-derivation.service.js';
import { AttendanceLeaveService } from './attendance-leave.service.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from './constants/attendance-enums.js';
import { CloseSkipReason } from './utils/close-day.js';

/**
 * A local spy rather than `jest.fn`.
 *
 * Under ESM Jest does not inject the `jest` global, and `@jest/globals` is not a
 * resolvable top-level package here, so importing it type-checks as `any` and
 * every assertion downstream goes unsafe. See the derivation suite, which hit
 * the same wall.
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

// Well in the past, so `assertClosable` never depends on the host clock.
const DATE = toUtcDateOnly('2026-08-11'); // a Tuesday
const SUNDAY = toUtcDateOnly('2026-08-09');

const SHIFT = { id: 'shift-day', weeklyOffDays: [0] };

type Fields = Record<string, unknown>;
type UpsertArgs = { where: Fields; create: Fields; update: Fields };
type UpdateArgs = { where: { id: string }; data: Fields };

type FakeEmployee = { id: string; employeeId: string; shiftId: string | null };

type FakeRow = {
  id: string;
  employeeId: string;
  source: AttendanceSource;
  status: AttendanceStatus;
  checkIn: Date | null;
  checkOut: Date | null;
  hasConflict: boolean;
  plannedAbsenceId: string | null;
};

const employee = (
  n: number,
  shiftId: string | null = SHIFT.id,
): FakeEmployee => ({
  id: `emp-${n}`,
  employeeId: `WFM-EMP-${n}`,
  shiftId,
});

const stored = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: 'row-1',
  employeeId: 'emp-1',
  source: AttendanceSource.DEVICE,
  status: AttendanceStatus.PRESENT,
  checkIn: ist('2026-08-11T09:00'),
  checkOut: ist('2026-08-11T18:00'),
  hasConflict: false,
  plannedAbsenceId: null,
  ...overrides,
});

const EMPTY_DERIVATION: DerivationSummary = {
  derived: 0,
  rowsCreated: 0,
  rowsUpdated: 0,
  conflicts: 0,
  skipped: [],
};

/**
 * Writes are collected as Prisma promises and handed to `$transaction` in one
 * go, so the stubs return markers and the assertions read the call arguments.
 */
function makeHarness(
  overrides: {
    employees?: FakeEmployee[];
    existing?: FakeRow[];
    leave?: Map<string, { id: string }>;
    isHoliday?: boolean;
    chunkSize?: number;
  } = {},
) {
  const upsert = spy((args: UpsertArgs) => ({ op: 'upsert', args }));
  const update = spy((args: UpdateArgs) => ({ op: 'update', args }));
  const createMany = spy((args: Fields) => ({ op: 'createMany', args }));
  const transaction = spy((ops: unknown[], options?: Fields) =>
    Promise.resolve([ops, options]),
  );

  const all = overrides.employees ?? [employee(1)];

  // Paged the way the service walks it: `take` plus an optional id cursor.
  const employeeFindMany = spy(
    (args: { take: number; cursor?: { id: string } }) => {
      const from = args.cursor
        ? all.findIndex((e) => e.id === args.cursor!.id) + 1
        : 0;

      return Promise.resolve(all.slice(from, from + args.take));
    },
  );

  const attendanceFindMany = spy(
    (args: { where: { employeeId: { in: string[] } } }) =>
      Promise.resolve(
        (overrides.existing ?? []).filter((row) =>
          args.where.employeeId.in.includes(row.employeeId),
        ),
      ),
  );

  const prisma = {
    employee: { findMany: employeeFindMany },
    attendance: { findMany: attendanceFindMany, upsert, update },
    shift: {
      findMany: spy(() =>
        Promise.resolve([{ id: SHIFT.id, weeklyOffDays: SHIFT.weeklyOffDays }]),
      ),
    },
    attendanceAuditLog: { createMany },
    $transaction: transaction,
  } as unknown as PrismaService;

  const holidayService = {
    findByDate: spy(() =>
      Promise.resolve(overrides.isHoliday ? { id: 'hol-1' } : null),
    ),
  } as unknown as HolidayService;

  const leaveService = {
    findApprovedForDate: spy(() =>
      Promise.resolve(overrides.leave ?? new Map()),
    ),
  } as unknown as AttendanceLeaveService;

  const deriveRange = spy(
    (_args: { from: Date; to: Date; employeeId?: string; force?: boolean }) =>
      Promise.resolve(EMPTY_DERIVATION),
  );
  const derivationService = {
    deriveRange,
  } as unknown as AttendanceDerivationService;

  const service = new AttendanceCloseService(
    prisma,
    new AttendancePolicyService(),
    holidayService,
    leaveService,
    derivationService,
    new AttendanceAuditService(prisma),
  );

  return {
    service,
    upsert,
    update,
    createMany,
    transaction,
    employeeFindMany,
    deriveRange,
  };
}

const close = (service: AttendanceCloseService, date = DATE) =>
  service.close({ date, actorId: 'admin-1' });

describe('AttendanceCloseService', () => {
  describe('filling the silence', () => {
    it('marks a working day with no row absent, as SYSTEM', async () => {
      const { service, upsert } = makeHarness();

      const summary = await close(service);

      expect(upsert.calls).toHaveLength(1);

      const { create } = upsert.calls[0][0];

      expect(create.status).toBe(AttendanceStatus.ABSENT);
      expect(create.dayType).toBe(DayType.WORKING);
      // The safety argument: tonight's row loses to any punch and any human.
      expect(create.source).toBe(AttendanceSource.SYSTEM);
      expect(create.shiftId).toBe(SHIFT.id);

      expect(summary.created).toEqual({
        absent: 1,
        onLeave: 0,
        notApplicable: 0,
      });
    });

    it('marks a weekly off NOT_APPLICABLE', async () => {
      const { service, upsert } = makeHarness();

      const summary = await close(service, SUNDAY);

      expect(upsert.calls[0][0].create.status).toBe(
        AttendanceStatus.NOT_APPLICABLE,
      );
      expect(summary.created.notApplicable).toBe(1);
      expect(summary.created.absent).toBe(0);
    });

    it('marks approved leave ON_LEAVE and links the absence', async () => {
      const { service, upsert } = makeHarness({
        leave: new Map([['emp-1', { id: 'absence-1' }]]),
      });

      const summary = await close(service);

      const { create } = upsert.calls[0][0];

      expect(create.status).toBe(AttendanceStatus.ON_LEAVE);
      expect(create.plannedAbsenceId).toBe('absence-1');
      expect(summary.created.onLeave).toBe(1);
    });

    it('lets a row that appeared mid-sweep win the race', async () => {
      // `update: {}` on the upsert. A punch landing between the read and the
      // write outranks SYSTEM, so the correct outcome is to keep its answer
      // rather than to throw away the other 499 rows in the transaction.
      const { service, upsert } = makeHarness();

      await close(service);

      expect(upsert.calls[0][0].update).toEqual({});
    });
  });

  describe('rows that already exist', () => {
    it('leaves a manually marked day untouched and unaudited', async () => {
      const { service, upsert, update, createMany } = makeHarness({
        existing: [
          stored({
            source: AttendanceSource.MANUAL,
            status: AttendanceStatus.ABSENT,
            checkIn: null,
            checkOut: null,
          }),
        ],
      });

      const summary = await close(service);

      expect(upsert.calls).toHaveLength(0);
      expect(update.calls).toHaveLength(0);
      expect(createMany.calls).toHaveLength(0);
      expect(summary.untouched).toBe(1);
    });

    it('flags a punched day that approved leave covers', async () => {
      const { service, update } = makeHarness({
        existing: [stored()],
        leave: new Map([['emp-1', { id: 'absence-1' }]]),
      });

      const summary = await close(service);

      expect(update.calls).toHaveLength(1);

      const { where, data } = update.calls[0][0];

      expect(where.id).toBe('row-1');
      // Exactly two fields. Anything else here would be the row being edited.
      expect(Object.keys(data).sort()).toEqual(['conflictNote', 'hasConflict']);
      expect(summary.conflictsFlagged).toBe(1);
    });

    it('audits a change to an existing row', async () => {
      const { service, createMany } = makeHarness({
        existing: [stored()],
        leave: new Map([['emp-1', { id: 'absence-1' }]]),
      });

      await close(service);

      expect(createMany.calls).toHaveLength(1);

      const [entry] = (
        createMany.calls[0][0] as { data: { changedById: string | null }[] }
      ).data;

      expect(entry.changedById).toBe('admin-1');
    });

    it('does not audit the absences it creates', async () => {
      // Every absence every night would bury the entries that matter under the
      // ones that do not. `source: SYSTEM` on the row already says who wrote it.
      const { service, createMany } = makeHarness({
        employees: [employee(1), employee(2)],
      });

      await close(service);

      expect(createMany.calls).toHaveLength(0);
    });

    it('completes a device row that never checked out', async () => {
      const { service, update } = makeHarness({
        existing: [stored({ checkOut: null })],
      });

      const summary = await close(service);

      expect(update.calls[0][0].data).toEqual({
        status: AttendanceStatus.MISSING_CHECKOUT,
      });
      expect(summary.missingCheckoutFixed).toBe(1);
    });
  });

  describe('idempotency — the exit criterion', () => {
    it('writes nothing on a second run over its own output', async () => {
      // The state run one produced: a SYSTEM absence for the day.
      const { service, upsert, update, transaction } = makeHarness({
        existing: [
          stored({
            source: AttendanceSource.SYSTEM,
            status: AttendanceStatus.ABSENT,
            checkIn: null,
            checkOut: null,
          }),
        ],
      });

      const summary = await close(service);

      expect(upsert.calls).toHaveLength(0);
      expect(update.calls).toHaveLength(0);
      // No writes planned means no transaction opened at all.
      expect(transaction.calls).toHaveLength(0);
      expect(summary.untouched).toBe(1);
      expect(summary.created).toEqual({
        absent: 0,
        onLeave: 0,
        notApplicable: 0,
      });
    });

    it('does not re-flag a conflict it already flagged', async () => {
      const { service, update } = makeHarness({
        existing: [stored({ hasConflict: true })],
        leave: new Map([['emp-1', { id: 'absence-1' }]]),
      });

      const summary = await close(service);

      expect(update.calls).toHaveLength(0);
      expect(summary.conflictsFlagged).toBe(0);
    });
  });

  describe('employees it cannot judge', () => {
    it('reports a shift-less employee by badge code and writes no row', async () => {
      // PRD §9 case 13. Assuming a 9-to-6 would produce plausible wrong numbers.
      const { service, upsert } = makeHarness({
        employees: [employee(1, null)],
      });

      const summary = await close(service);

      expect(upsert.calls).toHaveLength(0);
      expect(summary.skipped).toEqual([
        {
          employeeId: 'WFM-EMP-1',
          reason: CloseSkipReason.NO_SHIFT_ASSIGNED,
        },
      ]);
    });

    it('closes everybody else in the same run', async () => {
      const { service, upsert } = makeHarness({
        employees: [employee(1, null), employee(2)],
      });

      const summary = await close(service);

      expect(upsert.calls).toHaveLength(1);
      expect(summary.skipped).toHaveLength(1);
      expect(summary.created.absent).toBe(1);
      expect(summary.employeesConsidered).toBe(2);
    });
  });

  describe('the sweep', () => {
    it('derives from punches before filling gaps', async () => {
      // A device that synced late must become PRESENT, not ABSENT-then-corrected.
      const { service, deriveRange } = makeHarness();

      const summary = await close(service);

      expect(deriveRange.calls).toHaveLength(1);
      expect(summary.derivation).toEqual(EMPTY_DERIVATION);
    });

    it('re-reads punches ingestion already marked processed', async () => {
      // `isProcessed` means ingestion looked at the punch, not that a row came
      // out of it. Trusting it here writes ABSENT over a day somebody worked —
      // observed against real data before this was forced.
      const { service, deriveRange } = makeHarness();

      await close(service);

      expect(deriveRange.calls[0][0]).toEqual({
        from: DATE,
        to: DATE,
        force: true,
      });
    });

    it('walks past the chunk size by cursor', async () => {
      // 501 employees: two pages, and the second must start after the first ends
      // rather than repeating it.
      const employees = Array.from({ length: 501 }, (_, i) => employee(i + 1));
      const { service, upsert, employeeFindMany } = makeHarness({ employees });

      const summary = await close(service);

      expect(employeeFindMany.calls).toHaveLength(2);
      expect(employeeFindMany.calls[0][0].cursor).toBeUndefined();
      expect(employeeFindMany.calls[1][0].cursor).toEqual({ id: 'emp-500' });

      expect(summary.employeesConsidered).toBe(501);
      expect(upsert.calls).toHaveLength(501);
    });

    it('stops on the empty page when headcount is an exact multiple', async () => {
      // A full page cannot be known to be the last one without asking, so an
      // exact multiple costs one empty read. The short-page check saves it in
      // every other case, which is all of them but one in five hundred.
      const employees = Array.from({ length: 500 }, (_, i) => employee(i + 1));
      const { service, employeeFindMany, transaction } = makeHarness({
        employees,
      });

      const summary = await close(service);

      expect(employeeFindMany.calls).toHaveLength(2);
      // The empty page plans no writes, so it opens no transaction either.
      expect(transaction.calls).toHaveLength(1);
      expect(summary.employeesConsidered).toBe(500);
    });

    it('stops after one read when the page comes back short', async () => {
      const { service, employeeFindMany } = makeHarness();

      await close(service);

      expect(employeeFindMany.calls).toHaveLength(1);
    });

    it('opens one transaction per chunk, with the cold-start budget', async () => {
      const employees = Array.from({ length: 501 }, (_, i) => employee(i + 1));
      const { service, transaction } = makeHarness({ employees });

      await close(service);

      expect(transaction.calls).toHaveLength(2);
      expect(transaction.calls[0][1]).toEqual({
        timeout: 15000,
        maxWait: 10000,
      });
    });
  });

  describe('guards', () => {
    it('refuses a future date', async () => {
      const { service } = makeHarness();

      await expect(close(service, toUtcDateOnly('2099-01-01'))).rejects.toThrow(
        'is not in the past',
      );
    });

    it('refuses today', async () => {
      // A day still running: closing it marks ABSENT everybody who has not
      // punched in yet.
      const { service } = makeHarness();
      const today = new Date();

      await expect(close(service, toUtcDateOnly(today))).rejects.toThrow(
        'is not in the past',
      );
    });

    it('does not derive when the date is refused', async () => {
      const { service, deriveRange } = makeHarness();

      await expect(
        close(service, toUtcDateOnly('2099-01-01')),
      ).rejects.toThrow();

      expect(deriveRange.calls).toHaveLength(0);
    });
  });
});
