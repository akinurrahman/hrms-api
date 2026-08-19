import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { eachDateInRange, toDateKey } from '../common/utils/date.js';
import { employeeEligibleInRange } from '../common/utils/employee-eligibility.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';
import { AttendanceLeaveService } from './attendance-leave.service.js';
import { PeriodStatus } from './constants/attendance-enums.js';
import {
  SUMMARY_ROW_SELECT,
  SummaryAttendanceRow,
} from './constants/summary-row.constant.js';
import { FindMonthlyDto } from './dto/find-monthly.dto.js';
import {
  checkReconciliation,
  countDaysInclusive,
  eligibleWindow,
  splitByWindow,
  summariseEmployee,
} from './utils/monthly-summary.js';
import { calendarMonthWindow } from './utils/period-window.js';

const EMPLOYEE_SELECT = {
  id: true,
  employeeId: true,
  fullName: true,
  dateOfJoining: true,
  lastWorkingDay: true,
  designation: { select: { title: true } },
} satisfies Prisma.EmployeeSelect;

type MonthlyEmployee = Prisma.EmployeeGetPayload<{
  select: typeof EMPLOYEE_SELECT;
}>;

/**
 * The monthly sheet: employees down, days across, totals on the right.
 *
 * Read-only, and it is the screen HR checks a month on *before* asking for it to
 * be locked. Which means the totals it shows have to be the totals the lock
 * writes — so both run `summariseEmployee` over the same `SUMMARY_ROW_SELECT`
 * rows. A sheet that computes its own version of the arithmetic would disagree
 * with payroll's snapshot eventually, and the disagreement would surface as a
 * dispute rather than as a bug.
 *
 * It shows `reconciles` rather than refusing anything. Refusing is the lock's
 * job; this screen's job is to let somebody see *which* employee's month does
 * not add up, before they are told the whole month cannot be closed.
 *
 * Query shape is fixed at five regardless of page size: the period, employees +
 * count, that page's rows, and the leave types those rows point at. Nothing
 * queries inside the row loop.
 */
@Injectable()
export class AttendanceMonthlyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveService: AttendanceLeaveService,
  ) {}

  async findMonthly(query: FindMonthlyDto) {
    const { page, limit } = query;
    const { take, skip } = getPaginationParams({ page, limit });

    const period = await this.resolvePeriod(query.year, query.month);

    // `employeeEligibleInRange` carries an `OR`; composing under `AND` keeps it
    // from being clobbered by anything this filter grows later.
    const where: Prisma.EmployeeWhereInput = {
      AND: [employeeEligibleInRange(period.startDate, period.endDate)],
    };

    const [employees, total] = await this.prisma.$transaction(
      [
        this.prisma.employee.findMany({
          where,
          select: EMPLOYEE_SELECT,
          // Badge code, so the same employee sits on the same page between
          // requests — the roster's ordering, for the same reason.
          orderBy: { employeeId: 'asc' },
          take,
          skip,
        }),
        this.prisma.employee.count({ where }),
      ],
      { maxWait: 10000, timeout: 15000 },
    );

    const rowsByEmployee = await this.loadRows(
      employees.map((employee) => employee.id),
      period,
    );

    const isPaidByAbsenceId = await this.leaveService.findPaidFlags(
      absenceIdsIn(rowsByEmployee),
    );

    const dates = eachDateInRange(period.startDate, period.endDate);

    const data = employees.map((employee) =>
      this.buildRow({
        employee,
        period,
        dates,
        rows: rowsByEmployee.get(employee.id) ?? [],
        isPaidByAbsenceId,
      }),
    );

    return buildPaginatedResponse(data, total, page, limit, { period });
  }

  // ------------------------------------------------------------------ the row

  private buildRow(input: {
    employee: MonthlyEmployee;
    period: ResolvedPeriod;
    dates: Date[];
    rows: SummaryAttendanceRow[];
    isPaidByAbsenceId: ReadonlyMap<string, boolean>;
  }) {
    const { employee, dates, rows } = input;

    const window = eligibleWindow(input.period, employee);
    const rowByDate = new Map(
      rows.map((row) => [toDateKey(row.attendanceDate), row]),
    );

    // Cells for every day of the *cycle*, not of the employee's window, so the
    // grid stays rectangular and a joiner's first day is visible as a boundary
    // rather than as a shorter row.
    const days = dates.map((date) => {
      const row = rowByDate.get(toDateKey(date)) ?? null;
      const eligible =
        window !== null &&
        date.getTime() >= window.from.getTime() &&
        date.getTime() <= window.to.getTime();

      return {
        date: toDateKey(date),
        eligible,
        // `null` where nothing has decided the day — the same distinction the
        // roster draws between "not marked" and "marked".
        attendanceId: row?.id ?? null,
        dayType: row?.dayType ?? null,
        status: row?.status ?? null,
        workedMinutes: row?.workedMinutes ?? null,
        overtimeMinutes: row?.overtimeMinutes ?? null,
        hasConflict: row?.hasConflict ?? false,
      };
    });

    if (window === null) {
      // On rolls for no part of this cycle. Returned rather than filtered out:
      // the query selected them because they overlap the *label* year/month, and
      // silently dropping a row from a paginated list is worse than an empty one.
      return {
        employee: describe(employee),
        eligibleDays: 0,
        days,
        totals: null,
        reconciles: true,
      };
    }

    const { inWindow } = splitByWindow(rows, window);

    const totals = summariseEmployee({
      eligibleDays: countDaysInclusive(window.from, window.to),
      rows: inWindow,
      isPaidByAbsenceId: input.isPaidByAbsenceId,
    });

    return {
      employee: describe(employee),
      eligibleDays: totals.eligibleDays,
      days,
      totals,
      // PRD §4.4's invariant, shown rather than thrown. This is the number HR
      // has to fix before the month will lock.
      reconciles: checkReconciliation(totals).ok,
    };
  }

  // -------------------------------------------------------------------- reads

  /**
   * The declared cycle for this label, or the calendar month it would default
   * to.
   *
   * A month nobody has declared is still viewable — the sheet is how HR reviews
   * a month, and requiring a period row first would mean the review cannot start
   * until somebody has created the thing that only exists to be locked.
   */
  private async resolvePeriod(
    year: number,
    month: number,
  ): Promise<ResolvedPeriod> {
    const declared = await this.prisma.attendancePeriod.findUnique({
      where: { year_month: { year, month } },
      select: {
        id: true,
        year: true,
        month: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });

    if (declared) return declared;

    return {
      id: null,
      year,
      month,
      ...calendarMonthWindow(year, month),
      status: PeriodStatus.OPEN,
    };
  }

  private async loadRows(employeeIds: string[], period: ResolvedPeriod) {
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
}

interface ResolvedPeriod {
  /** `null` when no period has been declared for this label yet. */
  id: string | null;
  year: number;
  month: number;
  startDate: Date;
  endDate: Date;
  status: PeriodStatus;
}

function describe(employee: MonthlyEmployee) {
  return {
    id: employee.id,
    employeeId: employee.employeeId,
    fullName: employee.fullName,
    designation: employee.designation.title,
  };
}

/** The distinct absences a month's rows point at, for one leave-type lookup. */
export function absenceIdsIn(
  rowsByEmployee: ReadonlyMap<string, SummaryAttendanceRow[]>,
): string[] {
  const ids = new Set<string>();

  for (const rows of rowsByEmployee.values()) {
    for (const row of rows) {
      if (row.plannedAbsenceId !== null) ids.add(row.plannedAbsenceId);
    }
  }

  return [...ids];
}
