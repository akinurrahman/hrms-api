import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';
import { CreateShiftDto } from './dto/create-shift.dto.js';
import { UpdateShiftDto } from './dto/update-shift.dto.js';
import { FindShiftDto } from './dto/find-shift.dto.js';
import {
  isNightShift,
  minutesToHHmm,
  netShiftMinutes,
  shiftSpanMinutes,
} from './utils/shift-time.js';

/** The cross-field shape the validation rules are checked against. */
interface ShiftRules {
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  graceMinutes: number;
  weeklyOffDays: number[];
}

const DEFAULTS = {
  breakMinutes: 0,
  graceMinutes: 0,
  weeklyOffDays: [0],
} as const;

@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShiftDto) {
    const shift = {
      ...dto,
      code: dto.code.trim().toUpperCase(),
      breakMinutes: dto.breakMinutes ?? DEFAULTS.breakMinutes,
      graceMinutes: dto.graceMinutes ?? DEFAULTS.graceMinutes,
      weeklyOffDays: dto.weeklyOffDays ?? [...DEFAULTS.weeklyOffDays],
    };

    this.assertShiftValid(shift);

    try {
      const created = await this.prisma.shift.create({ data: shift });
      return this.withDerived(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
      ) {
        throw new ConflictException(
          `A shift with code ${shift.code} already exists`,
        );
      }
      throw error;
    }
  }

  async findAll(query: FindShiftDto) {
    const { isActive, search, page, limit } = query;
    const { skip, take } = getPaginationParams(query);

    const where: Prisma.ShiftWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.shift.findMany({
          where,
          skip,
          take,
          orderBy: [{ isActive: 'desc' }, { startMinutes: 'asc' }],
        }),
        this.prisma.shift.count({ where }),
      ],
      { timeout: 15000, maxWait: 10000 },
    );

    return buildPaginatedResponse(
      data.map((shift) => this.withDerived(shift)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    const { _count, ...rest } = shift;

    return {
      ...this.withDerived(rest),
      assignedEmployeeCount: _count.employees,
    };
  }

  async update(id: string, dto: UpdateShiftDto) {
    const existing = await this.prisma.shift.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Shift not found');
    }

    // Validate the shift as it will be after the patch, not as it is now —
    // changing endMinutes alone can invalidate an untouched breakMinutes.
    const merged: ShiftRules = {
      startMinutes: dto.startMinutes ?? existing.startMinutes,
      endMinutes: dto.endMinutes ?? existing.endMinutes,
      breakMinutes: dto.breakMinutes ?? existing.breakMinutes,
      graceMinutes: dto.graceMinutes ?? existing.graceMinutes,
      weeklyOffDays: dto.weeklyOffDays ?? existing.weeklyOffDays,
    };

    this.assertShiftValid(merged);

    try {
      const updated = await this.prisma.shift.update({
        where: { id },
        data: {
          ...merged,
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.code !== undefined && {
            code: dto.code.trim().toUpperCase(),
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      return this.withDerived(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
      ) {
        throw new ConflictException('A shift with this code already exists');
      }
      throw error;
    }
  }

  /**
   * Hard delete, refused while anyone is assigned. Letting the FK null out
   * would silently strip the shift off live employees and break aggregation
   * for them. Deactivate (`isActive = false`) to retire a shift instead.
   */
  async remove(id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    if (shift._count.employees > 0) {
      throw new ConflictException(
        `${shift._count.employees} employee(s) are still assigned to this shift. Reassign them, or set isActive to false to retire it.`,
      );
    }

    await this.prisma.shift.delete({ where: { id } });

    return { id };
  }

  /** `isNightShift` and `netShiftMinutes` are derived on read, never stored. */
  private withDerived<T extends ShiftRules>(shift: T) {
    return {
      ...shift,
      isNightShift: isNightShift(shift),
      netShiftMinutes: netShiftMinutes(shift),
      startTime: minutesToHHmm(shift.startMinutes),
      endTime: minutesToHHmm(shift.endMinutes),
    };
  }

  private assertShiftValid(shift: ShiftRules) {
    if (shift.startMinutes === shift.endMinutes) {
      throw new BadRequestException(
        'A shift cannot start and end at the same minute',
      );
    }

    const span = shiftSpanMinutes(shift);

    if (shift.breakMinutes >= span) {
      throw new BadRequestException(
        `breakMinutes (${shift.breakMinutes}) must be less than the shift span of ${span} minutes`,
      );
    }

    if (shift.graceMinutes >= span) {
      throw new BadRequestException(
        `graceMinutes (${shift.graceMinutes}) must be less than the shift span of ${span} minutes`,
      );
    }

    // The DTO rejects duplicates and out-of-range days; this catches the one
    // rule it cannot express — a shift with no working day left.
    if (shift.weeklyOffDays.length >= 7) {
      throw new BadRequestException(
        'weeklyOffDays cannot cover every day of the week',
      );
    }
  }
}
