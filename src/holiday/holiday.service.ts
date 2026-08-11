import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';
import {
  toDateKey,
  toUtcDateOnly,
  utcYearRange,
} from '../common/utils/date.js';
import { CreateHolidayDto } from './dto/create-holiday.dto.js';
import { UpdateHolidayDto } from './dto/update-holiday.dto.js';
import { FindHolidayDto } from './dto/find-holiday.dto.js';

@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateHolidayDto) {
    const date = toUtcDateOnly(dto.date);

    try {
      return await this.prisma.holiday.create({
        data: {
          name: dto.name.trim(),
          date,
          isOptional: dto.isOptional ?? false,
        },
      });
    } catch (error) {
      throw this.mapDuplicateDate(error, date);
    }
  }

  /** Whole year in one call — see the note on `FindHolidayDto` about pagination. */
  async findAll(query: FindHolidayDto) {
    const year = query.year ?? new Date().getUTCFullYear();
    const { start, end } = utcYearRange(year);

    const data = await this.prisma.holiday.findMany({
      where: {
        date: { gte: start, lt: end },
        ...(query.isOptional !== undefined && { isOptional: query.isOptional }),
      },
      orderBy: { date: 'asc' },
    });

    return { year, count: data.length, data };
  }

  async findOne(id: string) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    return holiday;
  }

  async update(id: string, dto: UpdateHolidayDto) {
    const existing = await this.prisma.holiday.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Holiday not found');
    }

    const date = dto.date !== undefined ? toUtcDateOnly(dto.date) : undefined;

    try {
      return await this.prisma.holiday.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(date !== undefined && { date }),
          ...(dto.isOptional !== undefined && { isOptional: dto.isOptional }),
        },
      });
    } catch (error) {
      throw this.mapDuplicateDate(error, date ?? existing.date);
    }
  }

  async remove(id: string) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    await this.prisma.holiday.delete({ where: { id } });

    return { id };
  }

  /**
   * Holiday lookup for a single date, keyed to UTC midnight.
   *
   * The seam the roster and the nightly close job read through, so "is this
   * date a holiday" has one definition rather than one per caller.
   */
  async findByDate(date: Date | string) {
    return this.prisma.holiday.findUnique({
      where: { date: toUtcDateOnly(date) },
    });
  }

  /**
   * Every holiday in `[from, to]`, as a `YYYY-MM-DD` → holiday map.
   *
   * One query per range instead of one per day; the monthly sheet would
   * otherwise issue thirty-odd lookups to render a single screen.
   */
  async findMapForRange(from: Date | string, to: Date | string) {
    const start = toUtcDateOnly(from);
    const end = toUtcDateOnly(to);

    const holidays = await this.prisma.holiday.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });

    return new Map(
      holidays.map((holiday) => [toDateKey(holiday.date), holiday]),
    );
  }

  /**
   * The DB unique constraint on `date` is the real duplicate check — a
   * read-then-write in the service would still race two concurrent creates.
   */
  private mapDuplicateDate(error: unknown, date: Date) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
    ) {
      return new ConflictException(
        `A holiday is already declared on ${toDateKey(date)}`,
      );
    }

    return error;
  }
}
