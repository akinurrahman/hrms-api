import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PlannedAbsenceStatus } from '../generated/prisma/enums.js';
import { parseDateOnlyOrThrow, toDateKey } from '../common/utils/date.js';
import { isEmployeeEligibleOn } from '../common/utils/employee-eligibility.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';
import { AttendanceLeaveService } from '../attendance/attendance-leave.service.js';
import { CancelPlannedAbsenceDto } from './dto/cancel-planned-absence.dto.js';
import { CreatePlannedAbsenceDto } from './dto/create-planned-absence.dto.js';
import { FindPlannedAbsenceDto } from './dto/find-planned-absence.dto.js';

const ABSENCE_INCLUDE = {
  leaveType: { select: { id: true, code: true, name: true, isPaid: true } },
  employee: { select: { id: true, employeeId: true, fullName: true } },
} satisfies Prisma.PlannedAbsenceInclude;

/**
 * Leave, reduced to the part attendance cannot work without.
 *
 * No balances, no accrual, no approval chain — those are the leave module's, and
 * building a bad version of them here would be worse than not having them, since
 * a balance nobody decrements looks like a balance. What this does provide is the
 * record an ON_LEAVE day points at, which is the piece that cannot be added
 * retroactively: a year of leave days with no type attached can never be
 * reconstructed into a ledger.
 *
 * The interesting behaviour is not the CRUD. It is that approving leave reaches
 * backwards into days that have already been decided.
 */
@Injectable()
export class PlannedAbsenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveService: AttendanceLeaveService,
  ) {}

  /**
   * File an absence, and fix the days it covers.
   *
   * One transaction, because the overlap check is a read-then-write — Postgres
   * can only express range exclusion through an exclusion constraint, which
   * Prisma does not model — and because the conversion has to commit with the
   * absence that caused it. Interactive rather than the array form: the
   * conversion needs the created row's id, and reads its targets.
   */
  async create(dto: CreatePlannedAbsenceDto, actorId: string) {
    const startDate = parseDateOnlyOrThrow(dto.startDate);
    const endDate = parseDateOnlyOrThrow(dto.endDate);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate cannot be before startDate');
    }

    // "Half of five days" describes nothing anybody can act on.
    if (dto.isHalfDay && startDate.getTime() !== endDate.getTime()) {
      throw new BadRequestException(
        'isHalfDay applies only to a single-day absence',
      );
    }

    const [employee, leaveType] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: dto.employeeId },
        select: {
          id: true,
          employeeId: true,
          dateOfJoining: true,
          lastWorkingDay: true,
        },
      }),
      this.prisma.leaveType.findUnique({
        where: { id: dto.leaveTypeId },
        select: { id: true, code: true, isActive: true },
      }),
    ]);

    if (!employee) throw new NotFoundException('Employee not found');
    if (!leaveType) throw new NotFoundException('Leave type not found');

    if (!leaveType.isActive) {
      throw new BadRequestException(
        `${leaveType.code} is no longer available for new leave`,
      );
    }

    // Both ends, not just one: a range that starts before someone joins or runs
    // past their last working day is half a leave for a person who was not there.
    for (const date of [startDate, endDate]) {
      if (!isEmployeeEligibleOn(employee, date)) {
        throw new BadRequestException(
          `${employee.employeeId} was not on rolls on ${toDateKey(date)} — check the joining date and last working day`,
        );
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Overlap, expressed the standard way: two ranges overlap when each
        // starts on or before the other ends.
        const clash = await tx.plannedAbsence.findFirst({
          where: {
            employeeId: dto.employeeId,
            status: PlannedAbsenceStatus.APPROVED,
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
          select: { id: true, startDate: true, endDate: true },
        });

        if (clash) {
          throw new ConflictException(
            `Overlaps an approved absence from ${toDateKey(clash.startDate)} to ${toDateKey(clash.endDate)}`,
          );
        }

        const absence = await tx.plannedAbsence.create({
          data: {
            employeeId: dto.employeeId,
            leaveTypeId: dto.leaveTypeId,
            startDate,
            endDate,
            isHalfDay: dto.isHalfDay ?? false,
            reason: dto.reason,
            approvedById: actorId,
          },
          include: ABSENCE_INCLUDE,
        });

        // The half of this endpoint that matters. Days already closed as ABSENT
        // by the nightly job become ON_LEAVE; days with a punch or a manual mark
        // on them are flagged instead, because a contradiction between "on
        // leave" and "was at work" is for a human to settle.
        const conversion = await this.leaveService.applyToExistingDays(tx, {
          absenceId: absence.id,
          employeeId: dto.employeeId,
          startDate,
          endDate,
          leaveCode: leaveType.code,
          actorId,
        });

        return { absence, ...conversion };
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }

  async findAll(query: FindPlannedAbsenceDto) {
    const { page, limit } = query;
    const { take, skip } = getPaginationParams({ page, limit });

    const from = query.from ? parseDateOnlyOrThrow(query.from) : undefined;
    const to = query.to ? parseDateOnlyOrThrow(query.to) : undefined;

    const where: Prisma.PlannedAbsenceWhereInput = {
      ...(query.employeeId && { employeeId: query.employeeId }),
      ...(query.status && { status: query.status }),
      // Overlap again, so a record spanning the boundary of the window still
      // appears in it.
      ...(to && { startDate: { lte: to } }),
      ...(from && { endDate: { gte: from } }),
    };

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.plannedAbsence.findMany({
          where,
          include: ABSENCE_INCLUDE,
          orderBy: { startDate: 'desc' },
          take,
          skip,
        }),
        this.prisma.plannedAbsence.count({ where }),
      ],
      { timeout: 15000, maxWait: 10000 },
    );

    return buildPaginatedResponse(data, total, page, limit);
  }

  async findOne(id: string) {
    const absence = await this.prisma.plannedAbsence.findUnique({
      where: { id },
      include: ABSENCE_INCLUDE,
    });

    if (!absence) throw new NotFoundException('Planned absence not found');

    return absence;
  }

  /**
   * Withdraw an absence.
   *
   * **Attendance rows are deliberately left alone.** PRD §6.5 says a
   * cancellation should recompute each covered day — a SYSTEM row reverting to
   * ABSENT or PRESENT, a MANUAL one being flagged — and refuse outright if the
   * period is locked. That is not built here: it needs the derivation service to
   * decide what a reverted day becomes, and the period guard (Phase 10) to know
   * when to refuse. Until then a cancelled absence can leave days still reading
   * ON_LEAVE, and the `plannedAbsenceId` on those rows is the trail back.
   */
  async cancel(id: string, dto: CancelPlannedAbsenceDto) {
    const absence = await this.prisma.plannedAbsence.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!absence) throw new NotFoundException('Planned absence not found');

    if (absence.status === PlannedAbsenceStatus.CANCELLED) {
      throw new ConflictException('This absence is already cancelled');
    }

    return this.prisma.plannedAbsence.update({
      where: { id },
      data: {
        status: PlannedAbsenceStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: dto.cancelReason,
      },
      include: ABSENCE_INCLUDE,
    });
  }
}
