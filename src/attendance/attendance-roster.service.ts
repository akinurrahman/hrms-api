import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { businessToday, parseDateOnlyOrThrow } from '../common/utils/date.js';
import { employeeEligibleOn } from '../common/utils/employee-eligibility.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';
import { HolidayService } from '../holiday/holiday.service.js';
import { AttendanceLeaveService } from './attendance-leave.service.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import { FindRosterDto } from './dto/find-roster.dto.js';
import { resolveRosterState } from './utils/roster-state.js';

/** The shift fields the roster returns, and the ones Phase 7 will need. */
const SHIFT_SELECT = {
  id: true,
  code: true,
  name: true,
  startMinutes: true,
  endMinutes: true,
  breakMinutes: true,
  graceMinutes: true,
  weeklyOffDays: true,
} satisfies Prisma.ShiftSelect;

type RosterShift = Prisma.ShiftGetPayload<{ select: typeof SHIFT_SELECT }>;

/** The whole stored row — the roster returns it verbatim for drill-down. */
type RosterAttendanceRow = Prisma.AttendanceGetPayload<Record<string, never>>;

/**
 * The daily roster: every employee on rolls for one date, with whatever has been
 * decided about that day, or a computed description of it if nothing has.
 *
 * **Read-only, and that is a design constraint rather than a coincidence.**
 * Nothing here creates a row. The three states HR needs to tell apart — not
 * marked, marked by device, marked by HR — exist only because "a row exists"
 * means "this day has been decided". Pre-creating blank rows at midnight would
 * collapse the first two into each other and invent ghost days for people who
 * join mid-month.
 *
 * Query shape is fixed at six, regardless of page size: employees + count, then
 * that page's attendance, its distinct shifts, its approved leave, and the
 * date's holiday. No query runs inside the row loop.
 */
@Injectable()
export class AttendanceRosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AttendancePolicyService,
    private readonly holidayService: HolidayService,
    private readonly leaveService: AttendanceLeaveService,
  ) {}

  async findRoster(query: FindRosterDto) {
    const date = parseDateOnlyOrThrow(query.date);
    const { page, limit } = query;
    const { take, skip } = getPaginationParams({ page, limit });

    // `employeeEligibleOn` carries an `OR`; composing under `AND` keeps it from
    // being clobbered by anything else this filter grows later.
    const where: Prisma.EmployeeWhereInput = { AND: [employeeEligibleOn(date)] };

    const [employees, total] = await this.prisma.$transaction(
      [
        this.prisma.employee.findMany({
          where,
          select: {
            id: true,
            employeeId: true,
            fullName: true,
            shiftId: true,
            designation: { select: { title: true } },
          },
          // Badge code, so the same employee sits on the same page between
          // requests. `createdAt` would reshuffle nothing, but reads worse to
          // an HR user scanning down a printed list.
          orderBy: { employeeId: 'asc' },
          take,
          skip,
        }),
        this.prisma.employee.count({ where }),
      ],
      { maxWait: 10000, timeout: 15000 },
    );

    const employeeIds = employees.map((employee) => employee.id);
    const shiftIds = [
      ...new Set(
        employees
          .map((employee) => employee.shiftId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const [attendanceRows, shifts, absences, holiday, policy] =
      await Promise.all([
        this.loadAttendance(employeeIds, date),
        this.loadShifts(shiftIds),
        this.leaveService.findApprovedForDate(employeeIds, date),
        this.holidayService.findByDate(date),
        this.policyService.get(),
      ]);

    const isFuture =
      date.getTime() >
      businessToday(policy.businessUtcOffsetMinutes).getTime();

    const data = employees.map((employee) => {
      const shift = employee.shiftId
        ? (shifts.get(employee.shiftId) ?? null)
        : null;
      const attendance = attendanceRows.get(employee.id) ?? null;
      const plannedAbsence = absences.get(employee.id) ?? null;

      const state = resolveRosterState({
        attendanceDate: date,
        isHoliday: holiday !== null,
        weeklyOffDays: shift?.weeklyOffDays ?? null,
        attendance,
        isFuture,
        hasPlannedAbsence: plannedAbsence !== null,
      });

      return {
        employee: {
          id: employee.id,
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          designation: employee.designation.title,
        },
        // Included per row because Phase 7's override needs start/end/break/
        // grace to run `aggregate()` when HR types a time into the screen.
        shift,
        attendance,
        // The absence itself, not just the state it produced: the screen shows
        // *which* leave, and a row that reads ON_LEAVE without naming the type
        // sends HR to another screen to find out.
        plannedAbsence,
        ...state,
      };
    });

    return buildPaginatedResponse(data, total, page, limit);
  }

  /**
   * This page's rows only. Fetching every eligible employee's day would read the
   * whole site to render fifty lines of it.
   */
  private async loadAttendance(employeeIds: string[], date: Date) {
    const byEmployee = new Map<string, RosterAttendanceRow>();

    if (employeeIds.length === 0) return byEmployee;

    const rows = await this.prisma.attendance.findMany({
      where: { attendanceDate: date, employeeId: { in: employeeIds } },
    });

    for (const row of rows) byEmployee.set(row.employeeId, row);

    return byEmployee;
  }

  /**
   * Distinct shifts for the page in one query, mapped in memory. An `include`
   * on the employee query would re-fetch the same handful of shift rows once per
   * employee — a site typically runs three or four shifts across hundreds of
   * people.
   */
  private async loadShifts(shiftIds: string[]) {
    if (shiftIds.length === 0) return new Map<string, RosterShift>();

    const shifts = await this.prisma.shift.findMany({
      where: { id: { in: shiftIds } },
      select: SHIFT_SELECT,
    });

    return new Map(shifts.map((shift) => [shift.id, shift]));
  }
}
