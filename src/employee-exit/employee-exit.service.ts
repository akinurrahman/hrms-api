import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExitType } from '../generated/prisma/enums.js';
import { CreateEmployeeExitDto } from './dto/create-employee-exit.dto.js';
import { UpdateEmployeeExitDto } from './dto/update-employee-exit.dto.js';
import { ExitDocumentDto } from './dto/exit-document.dto.js';

/** Exit types where the employee initiated the separation and a resignation date exists. */
const VOLUNTARY_EXIT_TYPES: ExitType[] = [
  ExitType.RESIGNATION,
  ExitType.RETIREMENT,
];

/** Exit types that default to rehire-ineligible unless HR says otherwise. */
const REHIRE_INELIGIBLE_BY_DEFAULT: ExitType[] = [
  ExitType.DISMISSAL,
  ExitType.ABSCONDING,
];

const EXIT_INCLUDE = {
  documents: { orderBy: { createdAt: 'asc' } },
  processedBy: { select: { id: true, email: true } },
} as const;

/** UTC midnight for today, to compare against Prisma `@db.Date` values. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class EmployeeExitService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    employeeId: string,
    dto: CreateEmployeeExitDto,
    processedById: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, dateOfJoining: true, exit: { select: { id: true } } },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (employee.exit) {
      throw new ConflictException(
        'Employee has already been exited. Amend or revoke the existing exit record instead.',
      );
    }

    const lastWorkingDay = new Date(dto.lastWorkingDay);
    const resignationDate = dto.resignationDate
      ? new Date(dto.resignationDate)
      : null;

    this.assertDatesValid(
      dto.exitType,
      lastWorkingDay,
      resignationDate,
      employee.dateOfJoining,
    );
    dto.documents?.forEach((doc) => this.assertDocumentValid(doc));

    return this.prisma.$transaction(async (tx) => {
      const exit = await tx.employeeExit.create({
        data: {
          employeeId,
          processedById,
          exitType: dto.exitType,
          reason: dto.reason ?? null,
          notes: dto.notes ?? null,
          resignationDate,
          noticePeriodDays: dto.noticePeriodDays ?? null,
          isRehireEligible:
            dto.isRehireEligible ?? this.defaultRehireEligible(dto.exitType),
          rehireRemark: dto.rehireRemark ?? null,
          ...(dto.documents?.length && {
            documents: {
              create: dto.documents.map((doc) => ({
                type: doc.type,
                customName: doc.customName ?? null,
                fileKey: doc.fileKey,
                fileName: doc.fileName ?? null,
              })),
            },
          }),
        },
        include: EXIT_INCLUDE,
      });

      await tx.employee.update({
        where: { id: employeeId },
        data: {
          lastWorkingDay,
          isActive: this.isStillOnRolls(lastWorkingDay),
        },
      });

      return exit;
    });
  }

  async findOne(employeeId: string) {
    const exit = await this.prisma.employeeExit.findUnique({
      where: { employeeId },
      include: EXIT_INCLUDE,
    });

    if (!exit) {
      throw new NotFoundException('No exit record found for this employee');
    }

    return exit;
  }

  async update(employeeId: string, dto: UpdateEmployeeExitDto) {
    const existing = await this.prisma.employeeExit.findUnique({
      where: { employeeId },
      include: { employee: { select: { dateOfJoining: true } } },
    });

    if (!existing) {
      throw new NotFoundException('No exit record found for this employee');
    }

    // Validate the record as it will be after the patch, not as it is now —
    // a type change alone can invalidate an untouched resignationDate.
    const exitType = dto.exitType ?? existing.exitType;
    const lastWorkingDay = dto.lastWorkingDay
      ? new Date(dto.lastWorkingDay)
      : await this.currentLastWorkingDay(employeeId);
    const resignationDate =
      dto.resignationDate === undefined
        ? existing.resignationDate
        : new Date(dto.resignationDate);

    this.assertDatesValid(
      exitType,
      lastWorkingDay,
      resignationDate,
      existing.employee.dateOfJoining,
    );

    return this.prisma.$transaction(async (tx) => {
      const exit = await tx.employeeExit.update({
        where: { employeeId },
        data: {
          exitType,
          resignationDate,
          ...(dto.reason !== undefined && { reason: dto.reason }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.noticePeriodDays !== undefined && {
            noticePeriodDays: dto.noticePeriodDays,
          }),
          ...(dto.isRehireEligible !== undefined && {
            isRehireEligible: dto.isRehireEligible,
          }),
          ...(dto.rehireRemark !== undefined && {
            rehireRemark: dto.rehireRemark,
          }),
        },
        include: EXIT_INCLUDE,
      });

      if (dto.lastWorkingDay) {
        await tx.employee.update({
          where: { id: employeeId },
          data: {
            lastWorkingDay,
            isActive: this.isStillOnRolls(lastWorkingDay),
          },
        });
      }

      return exit;
    });
  }

  /**
   * Undo a wrongly-recorded exit. Hard delete — documents cascade. There is no
   * tombstone, so a revoked exit leaves no trace until an audit-log module exists.
   */
  async revoke(employeeId: string) {
    const existing = await this.prisma.employeeExit.findUnique({
      where: { employeeId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('No exit record found for this employee');
    }

    await this.prisma.$transaction([
      this.prisma.employeeExit.delete({ where: { employeeId } }),
      this.prisma.employee.update({
        where: { id: employeeId },
        data: { lastWorkingDay: null, isActive: true },
      }),
    ]);

    return { employeeId, revoked: true };
  }

  async addDocument(employeeId: string, dto: ExitDocumentDto) {
    const exit = await this.prisma.employeeExit.findUnique({
      where: { employeeId },
      select: { id: true },
    });

    if (!exit) {
      throw new NotFoundException('No exit record found for this employee');
    }

    this.assertDocumentValid(dto);

    return this.prisma.exitDocument.create({
      data: {
        exitId: exit.id,
        type: dto.type,
        customName: dto.customName ?? null,
        fileKey: dto.fileKey,
        fileName: dto.fileName ?? null,
      },
    });
  }

  async removeDocument(employeeId: string, documentId: string) {
    const document = await this.prisma.exitDocument.findUnique({
      where: { id: documentId },
      select: { id: true, exit: { select: { employeeId: true } } },
    });

    // Scoped by employee so a valid document id from another employee's exit
    // cannot be deleted through this route.
    if (!document || document.exit.employeeId !== employeeId) {
      throw new NotFoundException('Document not found');
    }

    await this.prisma.exitDocument.delete({ where: { id: documentId } });

    return { id: documentId };
  }

  private async currentLastWorkingDay(employeeId: string): Promise<Date> {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { lastWorkingDay: true },
    });

    if (!employee.lastWorkingDay) {
      throw new ConflictException(
        'Exit record exists but the employee has no last working day. Revoke and re-record the exit.',
      );
    }

    return employee.lastWorkingDay;
  }

  private assertDatesValid(
    exitType: ExitType,
    lastWorkingDay: Date,
    resignationDate: Date | null,
    dateOfJoining: Date,
  ) {
    if (lastWorkingDay < dateOfJoining) {
      throw new BadRequestException(
        'Last working day cannot be before the date of joining',
      );
    }

    if (!resignationDate) {
      return;
    }

    if (!VOLUNTARY_EXIT_TYPES.includes(exitType)) {
      throw new BadRequestException(
        `resignationDate applies only to ${VOLUNTARY_EXIT_TYPES.join(' and ')} exits`,
      );
    }

    if (resignationDate > lastWorkingDay) {
      throw new BadRequestException(
        'Resignation date cannot be after the last working day',
      );
    }

    if (resignationDate < dateOfJoining) {
      throw new BadRequestException(
        'Resignation date cannot be before the date of joining',
      );
    }
  }

  private assertDocumentValid(dto: ExitDocumentDto) {
    if (dto.customName && dto.type !== 'OTHER') {
      throw new BadRequestException(
        'customName applies only to documents of type OTHER',
      );
    }
  }

  private defaultRehireEligible(exitType: ExitType): boolean {
    return !REHIRE_INELIGIBLE_BY_DEFAULT.includes(exitType);
  }

  /**
   * `isActive` means "on rolls today", so an employee serving notice stays
   * active until their last working day passes. Nothing flips this once the
   * day arrives — the nightly close job (Phase 9) must sweep it.
   */
  private isStillOnRolls(lastWorkingDay: Date): boolean {
    return lastWorkingDay >= todayUtc();
  }
}
