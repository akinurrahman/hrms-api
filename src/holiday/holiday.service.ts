import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';
import { toDateKey, toUtcDateOnly } from '../common/utils/date.js';
import { CreateHolidayDto } from './dto/create-holiday.dto.js';
import { UpdateHolidayDto } from './dto/update-holiday.dto.js';
import { FindHolidayDto } from './dto/find-holiday.dto.js';
import { addYears, startOfYear } from 'date-fns';

@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateHolidayDto) {
    const date = this.parseDate(dto.date);

    try {
      return await this.prisma.holiday.create({
        data: {
          names: this.normaliseNames(dto.names),
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
    const start = startOfYear(new Date(year, 0, 1));
    const end = addYears(start, 1);

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

    const date = dto.date !== undefined ? this.parseDate(dto.date) : undefined;

    try {
      return await this.prisma.holiday.update({
        where: { id },
        data: {
          ...(dto.names !== undefined && {
            names: this.normaliseNames(dto.names),
          }),
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
   * "Is this date a holiday" — the seam the roster and the nightly close job
   * read through, so the question has one definition rather than one per caller.
   */
  async findByDate(date: Date | string) {
    return this.prisma.holiday.findUnique({
      where: { date: this.parseDate(date) },
    });
  }

  /**
   * Trim, then drop repeats case-insensitively.
   *
   * `@ArrayUnique()` on the DTO would compare the raw strings, so `"Diwali"`
   * and `" diwali "` pass validation and become duplicates the moment they are
   * trimmed. Deduping after normalising is the only ordering that holds.
   */
  private normaliseNames(names: string[]): string[] {
    const seen = new Set<string>();
    const cleaned: string[] = [];

    for (const name of names) {
      const trimmed = name.trim();
      const key = trimmed.toLowerCase();

      if (trimmed && !seen.has(key)) {
        seen.add(key);
        cleaned.push(trimmed);
      }
    }

    if (cleaned.length === 0) {
      throw new BadRequestException('names must contain at least one name');
    }

    return cleaned;
  }

  /**
   * `toUtcDateOnly` throws `RangeError` for a shape the DTO regex allows but
   * the calendar does not — `2026-02-30`. Left unhandled that escapes
   * `HttpExceptionFilter`, which only catches `HttpException`, and surfaces as
   * a 500 for what is plainly bad input.
   */
  private parseDate(input: Date | string): Date {
    try {
      return toUtcDateOnly(input);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * The DB unique constraint is the real duplicate check — a read-then-write in
   * the service would still race two concurrent creates.
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
