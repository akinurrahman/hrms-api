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
import { AttendanceDerivationService } from '../attendance/attendance-derivation.service.js';
import { AttendanceLeaveService } from '../attendance/attendance-leave.service.js';
import { AttendancePeriodService } from '../attendance/attendance-period.service.js';
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
    private readonly derivationService: AttendanceDerivationService,
    private readonly periodService: AttendancePeriodService,
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

    // Before the transaction opens, not inside it. The whole range, not just the
    // day it starts: an absence whose second half reaches into a locked month
    // would convert days payroll has already paid against. Checking here rather
    // than inside `applyToExistingDays` keeps the refusal with whoever owns the
    // commit — a 409 thrown mid-transaction leaves the caller unable to tell
    // whether its own `plannedAbsence.create` rolled back.
    await this.periodService.assertRangeOpen(startDate, endDate);

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
   * Withdraw an absence, and undo the days it authorised (PRD §6.5).
   *
   * The mirror of `create`, and it has to be. Approval reaching backwards is
   * only half a feature: a leave that flipped Tuesday to ON_LEAVE and is then
   * cancelled would otherwise leave Tuesday claiming an authorisation that no
   * longer exists, with nothing downstream able to notice.
   *
   * Withdraw rather than delete: attendance rows point at this record, and a
   * cancelled leave somebody has to explain later is exactly what the history is
   * for.
   *
   * Two commits on purpose. The reversion has to land with the cancellation, so
   * it shares the transaction. The re-derive afterwards does not — it is a
   * correction computed from the punch log, which is append-only, so it is safe
   * to retry and safe to have not run yet.
   *
   * A cancellation covering a locked period is refused outright (PRD §6.5). The
   * reversion is a write into a month payroll has closed, and there is no
   * half-measure available: leaving the days ON_LEAVE while the absence says
   * CANCELLED is the contradiction the reversion exists to prevent.
   */
  async cancel(id: string, dto: CancelPlannedAbsenceDto, actorId: string) {
    const absence = await this.prisma.plannedAbsence.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        leaveType: { select: { code: true } },
      },
    });

    if (!absence) throw new NotFoundException('Planned absence not found');

    if (absence.status === PlannedAbsenceStatus.CANCELLED) {
      throw new ConflictException('This absence is already cancelled');
    }

    await this.periodService.assertRangeOpen(
      absence.startDate,
      absence.endDate,
    );

    const result = await this.prisma.$transaction(
      async (tx) => {
        const cancelled = await tx.plannedAbsence.update({
          where: { id },
          data: {
            status: PlannedAbsenceStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: dto.cancelReason,
          },
          include: ABSENCE_INCLUDE,
        });

        // SYSTEM rows go back to ABSENT; days with a punch or a manual mark on
        // them are flagged instead, because a contradiction between "the leave
        // is withdrawn" and "the evidence says he was here" is for a human.
        const reversion = await this.leaveService.revertCancelledAbsence(tx, {
          absenceId: absence.id,
          employeeId: absence.employeeId,
          startDate: absence.startDate,
          endDate: absence.endDate,
          leaveCode: absence.leaveType.code,
          actorId,
        });

        return { absence: cancelled, ...reversion };
      },
      { timeout: 15000, maxWait: 10000 },
    );

    // §6.5's "or PRESENT if punches exist", and it needs no new logic: the
    // punches were never deleted, and SYSTEM loses to DEVICE, so a day that was
    // actually worked corrects itself. `force` because those punches were marked
    // processed the first time round.
    if (result.reverted > 0) {
      await this.derivationService.deriveRange({
        from: absence.startDate,
        to: absence.endDate,
        employeeId: absence.employeeId,
        force: true,
      });
    }

    return result;
  }
}
