import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';
import { employeeEligibleInRange } from '../common/utils/employee-eligibility.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';
import { AttendanceLeaveService } from './attendance-leave.service.js';
import { absenceIdsIn } from './attendance-monthly.service.js';
import { PeriodStatus } from './constants/attendance-enums.js';
import {
  SUMMARY_ROW_SELECT,
  SummaryAttendanceRow,
} from './constants/summary-row.constant.js';
import { FindSummaryDto } from './dto/find-summary.dto.js';
import { UnlockPeriodDto } from './dto/unlock-period.dto.js';
import {
  LockBlocker,
  LockCandidate,
  findLockBlockers,
} from './utils/lock-validation.js';
import {
  SummaryCounts,
  checkReconciliation,
  countDaysInclusive,
  eligibleWindow,
  splitByWindow,
  summariseEmployee,
} from './utils/monthly-summary.js';

/**
 * Employees per read pass. The same reasoning as the close job's chunk size: a
 * whole site's headcount plus a month of its rows in one query is the first
 * thing that breaks as the company grows.
 */
const LOCK_CHUNK_SIZE = 500;

/** Blockers enumerated in a refusal. The total count always travels. */
const MAX_REPORTED_BLOCKERS = 50;

const EMPLOYEE_SELECT = {
  id: true,
  employeeId: true,
  dateOfJoining: true,
  lastWorkingDay: true,
} satisfies Prisma.EmployeeSelect;

/** An employee whose month does not add up, and by how much. */
interface ReconciliationFailure {
  employeeId: string;
  sum: number;
  eligibleDays: number;
}

export interface LockResult {
  periodId: string;
  year: number;
  month: number;
  version: number;
  employeesSummarised: number;
  /** On rolls for no part of the cycle, so no snapshot was generated. */
  employeesSkipped: number;
  lockedAt: Date;
}

/**
 * Closing a payroll cycle: check the month is fit to be paid from, snapshot it,
 * and shut the door.
 *
 * The order matters and is the whole design. Validation and arithmetic happen
 * entirely outside the transaction — the same rule bulk override follows —
 * because a month that cannot be locked should cost one refusal rather than a
 * rolled-back write, and because holding a Neon transaction open across a
 * site-wide aggregation is how a lock times out at month end.
 *
 * Nothing here repairs anything. Every blocker it reports is a question only a
 * human can answer, and a lock that quietly fixed them would be laundering
 * uncertainty into payroll — which is precisely what the validation step exists
 * to prevent.
 *
 * It lives outside `AttendancePeriodService` on purpose: that service is the
 * guard every other write path in the module depends on, and it should not grow
 * a dependency on summary generation to stay callable.
 */
@Injectable()
export class AttendanceLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveService: AttendanceLeaveService,
  ) {}

  // --------------------------------------------------------------------- lock

  async lock(periodId: string, actorId: string): Promise<LockResult> {
    const period = await this.findPeriodOrThrow(periodId);

    if (period.status === PeriodStatus.LOCKED) {
      throw new ConflictException(
        `${period.year}-${String(period.month).padStart(2, '0')} is already locked`,
      );
    }

    const { blockers, failures, drafts, skipped } =
      await this.reviewPeriod(period);

    this.assertNoBlockers(blockers);
    this.assertReconciled(failures);

    const version = await this.nextVersion(period.id);
    const lockedAt = new Date();

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Compare-and-swap. Two concurrent locks both pass the validation
          // above — it holds no lock and cannot — so the one that arrives second
          // matches zero rows here and its whole transaction unwinds, summaries
          // included. A `findUnique` and a branch would read the same state
          // without reserving it.
          const claimed = await tx.attendancePeriod.updateMany({
            where: { id: period.id, status: PeriodStatus.OPEN },
            data: {
              status: PeriodStatus.LOCKED,
              lockedById: actorId,
              lockedAt,
            },
          });

          if (claimed.count === 0) {
            throw new ConflictException(
              'The period was locked by somebody else while this lock was being prepared',
            );
          }

          // Superseded, not deleted. Payroll may already have paid against the
          // previous version, and a dispute reads what it said at the time.
          await tx.monthlyAttendanceSummary.updateMany({
            where: { periodId: period.id, isCurrent: true },
            data: { isCurrent: false },
          });

          await tx.monthlyAttendanceSummary.createMany({
            data: drafts.map((draft) => ({
              ...draft.counts,
              employeeId: draft.employeeId,
              periodId: period.id,
              version,
              generatedById: actorId,
            })),
          });
        },
        { timeout: 15000, maxWait: 10000 },
      );
    } catch (error) {
      throw this.mapDuplicateVersion(error, version);
    }

    return {
      periodId: period.id,
      year: period.year,
      month: period.month,
      version,
      employeesSummarised: drafts.length,
      employeesSkipped: skipped,
      lockedAt,
    };
  }

  // ------------------------------------------------------------------- unlock

  /**
   * Reopen a locked cycle.
   *
   * The summaries are deliberately left alone. They stay `isCurrent` until a
   * relock supersedes them, because between unlock and relock the month has no
   * agreed numbers at all, and deleting the last set that anybody agreed on
   * would leave payroll holding figures it can no longer trace.
   */
  async unlock(periodId: string, actorId: string, dto: UnlockPeriodDto) {
    const period = await this.findPeriodOrThrow(periodId);

    if (period.status !== PeriodStatus.LOCKED) {
      throw new ConflictException(
        `${period.year}-${String(period.month).padStart(2, '0')} is not locked`,
      );
    }

    return this.prisma.attendancePeriod.update({
      where: { id: period.id },
      data: {
        status: PeriodStatus.OPEN,
        unlockedById: actorId,
        unlockedAt: new Date(),
        unlockReason: dto.unlockReason,
      },
    });
  }

  // ---------------------------------------------------------------- summaries

  /**
   * What a lock produced. Defaults to the current version — payroll's read —
   * with `?version=` for the history a dispute needs.
   */
  async findSummaries(periodId: string, query: FindSummaryDto) {
    await this.findPeriodOrThrow(periodId);

    const { page, limit } = query;
    const { take, skip } = getPaginationParams({ page, limit });

    const where: Prisma.MonthlyAttendanceSummaryWhereInput = {
      periodId,
      ...(query.version !== undefined
        ? { version: query.version }
        : { isCurrent: true }),
    };

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.monthlyAttendanceSummary.findMany({
          where,
          include: {
            employee: {
              select: { id: true, employeeId: true, fullName: true },
            },
          },
          orderBy: { employee: { employeeId: 'asc' } },
          take,
          skip,
        }),
        this.prisma.monthlyAttendanceSummary.count({ where }),
      ],
      { maxWait: 10000, timeout: 15000 },
    );

    return buildPaginatedResponse(data, total, page, limit);
  }

  // --------------------------------------------------------------- the review

  /**
   * Every eligible employee's month, checked and counted, in bounded passes.
   *
   * Blockers and reconciliation failures are both collected in full rather than
   * thrown at the first one. HR fixing a month one refusal at a time, with a
   * fresh site-wide pass between each, is not a workflow.
   */
  private async reviewPeriod(period: PeriodRow) {
    const blockers: LockBlocker[] = [];
    const failures: ReconciliationFailure[] = [];
    const drafts: SummaryDraft[] = [];

    let skipped = 0;
    let cursor: string | undefined;

    for (;;) {
      const employees = await this.loadEmployeeChunk(period, cursor);

      if (employees.length === 0) break;

      const rowsByEmployee = await this.loadRows(
        employees.map((employee) => employee.id),
        period,
      );

      const isPaidByAbsenceId = await this.leaveService.findPaidFlags(
        absenceIdsIn(rowsByEmployee),
      );

      const candidates: LockCandidate[] = [];

      for (const employee of employees) {
        const window = eligibleWindow(period, employee);
        const rows = rowsByEmployee.get(employee.id) ?? [];

        candidates.push({ employeeId: employee.employeeId, window, rows });

        // On rolls for no part of the cycle — a joiner whose start date lands
        // after it ended, or somebody who left before it began. No window means
        // no eligible days, and a summary of nothing is not a snapshot.
        if (window === null) {
          skipped += 1;
          continue;
        }

        const counts = summariseEmployee({
          eligibleDays: countDaysInclusive(window.from, window.to),
          rows: splitByWindow(rows, window).inWindow,
          isPaidByAbsenceId,
        });

        const reconciliation = checkReconciliation(counts);

        if (!reconciliation.ok) {
          failures.push({
            employeeId: employee.employeeId,
            sum: reconciliation.sum,
            eligibleDays: reconciliation.eligibleDays,
          });
        }

        drafts.push({ employeeId: employee.id, counts });
      }

      blockers.push(
        ...findLockBlockers({ employees: candidates, isPaidByAbsenceId }),
      );

      if (employees.length < LOCK_CHUNK_SIZE) break;

      cursor = employees[employees.length - 1].id;
    }

    return { blockers, failures, drafts, skipped };
  }

  // ------------------------------------------------------------------- guards

  /**
   * The refusal that makes the lock mean something.
   *
   * Locking a month that still contains unfinished records does not produce
   * uncertain numbers — it produces confident ones nobody has checked, which
   * payroll then pays against.
   */
  private assertNoBlockers(blockers: LockBlocker[]) {
    if (blockers.length === 0) return;

    throw new ConflictException({
      message: `${blockers.length} unresolved issue(s) must be cleared before this cycle can be locked`,
      errors: blockers.slice(0, MAX_REPORTED_BLOCKERS),
    });
  }

  /**
   * PRD §4.4's invariant, per employee.
   *
   * It fails when an employee's days do not add up to the days they were on
   * rolls for, which almost always means the close job's output is wrong rather
   * than this arithmetic — a gap from a failed cron night, a mid-month joiner
   * whose first day was never created, a row nothing can classify. Blocking here
   * is the last point at which any of that is still cheap to fix.
   */
  private assertReconciled(failures: ReconciliationFailure[]) {
    if (failures.length === 0) return;

    throw new ConflictException({
      message: `Day counts do not reconcile for ${failures.length} employee(s) — their buckets must sum to their eligible days before this cycle can be locked`,
      errors: failures.slice(0, MAX_REPORTED_BLOCKERS),
    });
  }

  // -------------------------------------------------------------------- reads

  private async findPeriodOrThrow(periodId: string): Promise<PeriodRow> {
    const period = await this.prisma.attendancePeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        year: true,
        month: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });

    if (!period) throw new NotFoundException('Attendance period not found');

    return period;
  }

  /**
   * Cursor rather than `skip`, matching the close job: the walk is long enough
   * that an offset-based one could skip or repeat an employee if the table is
   * written to underneath it.
   */
  private async loadEmployeeChunk(period: PeriodRow, cursor?: string) {
    return this.prisma.employee.findMany({
      // `employeeEligibleInRange` carries an `OR`; composing under `AND` keeps
      // it from being clobbered by anything this filter grows later.
      where: {
        AND: [employeeEligibleInRange(period.startDate, period.endDate)],
      },
      select: EMPLOYEE_SELECT,
      orderBy: { id: 'asc' },
      take: LOCK_CHUNK_SIZE,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
  }

  private async loadRows(employeeIds: string[], period: PeriodRow) {
    const byEmployee = new Map<string, SummaryAttendanceRow[]>();

    if (employeeIds.length === 0) return byEmployee;

    const rows = await this.prisma.attendance.findMany({
      where: {
        employeeId: { in: employeeIds },
        attendanceDate: { gte: period.startDate, lte: period.endDate },
      },
      select: SUMMARY_ROW_SELECT,
    });

    for (const row of rows) {
      const existing = byEmployee.get(row.employeeId);

      if (existing) existing.push(row);
      else byEmployee.set(row.employeeId, [row]);
    }

    return byEmployee;
  }

  /**
   * One past the highest version this period has ever had — not the count of
   * current rows, which would repeat a version after a regeneration that covered
   * fewer employees.
   */
  private async nextVersion(periodId: string): Promise<number> {
    const highest = await this.prisma.monthlyAttendanceSummary.aggregate({
      where: { periodId },
      _max: { version: true },
    });

    return (highest._max.version ?? 0) + 1;
  }

  /**
   * `@@unique([employeeId, periodId, version])` is the real guard behind the
   * compare-and-swap above: two locks that somehow both claimed the period would
   * still collide here rather than write two sets of numbers for one version.
   */
  private mapDuplicateVersion(error: unknown, version: number) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
    ) {
      return new ConflictException(
        `Version ${version} of this cycle's summaries already exists — another lock ran concurrently`,
      );
    }

    return error;
  }
}

interface PeriodRow {
  id: string;
  year: number;
  month: number;
  startDate: Date;
  endDate: Date;
  status: PeriodStatus;
}

interface SummaryDraft {
  /** The uuid — this one is a foreign key, not a badge code for a human. */
  employeeId: string;
  counts: SummaryCounts;
}
