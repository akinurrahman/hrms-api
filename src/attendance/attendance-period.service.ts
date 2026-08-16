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
  getPaginationParams,
  buildPaginatedResponse,
} from '../common/utils/paginate.js';
import {
  parseDateOnlyOrThrow,
  toDateKey,
  toUtcDateOnly,
} from '../common/utils/date.js';
import { PeriodStatus } from './constants/attendance-enums.js';
import {
  PeriodBounds,
  calendarMonthWindow,
  lockedDateKeys,
} from './utils/period-window.js';
import { CreateAttendancePeriodDto } from './dto/create-attendance-period.dto.js';
import { FindAttendancePeriodDto } from './dto/find-attendance-period.dto.js';

/** The longest a cycle may run. See `assertLength`. */
const MAX_PERIOD_DAYS = 45;

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Everything a refusal message needs, and nothing the guard has to load twice. */
const LOCKED_SELECT = {
  year: true,
  month: true,
  startDate: true,
  endDate: true,
} as const;

/**
 * The lock, and the only question the rest of the module asks it.
 *
 * Every lookup here resolves a period by `startDate <= date <= endDate`. Nothing
 * extracts a month from a date, and nothing may start to: `year`/`month` is the
 * label a payslip prints, not the boundary payroll runs on, and a 26-to-25 cycle
 * makes the two disagree for six days out of every thirty.
 *
 * A date no period covers is OPEN. That is a decision rather than an oversight —
 * the alternative, treating an undeclared month as closed, means the whole module
 * stops writing at midnight on 31 December because nobody created next year.
 *
 * The refusals throw `ConflictException`, not `BadRequestException`. The request
 * is well formed; the state of the period refuses it, and the client retries it
 * unchanged once the period reopens. That is deliberately different from the two
 * guards next door — `assertWritable` (future date) and `assertClosable` (day not
 * finished) — which are arguments about the input and stay 400s.
 */
@Injectable()
export class AttendancePeriodService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ guards

  /**
   * Refuse if a LOCKED period covers any day of `[from, to]`, both inclusive.
   *
   * One query, whatever the range: a leave spanning three weeks asks the same
   * question as a single day, and expanding the range into a date list first
   * would allocate a list nobody reads and inherit `MAX_DATE_RANGE_DAYS` as a
   * limit on something that has no reason to have one.
   */
  async assertRangeOpen(from: Date, to: Date): Promise<void> {
    const start = toUtcDateOnly(from);
    const end = toUtcDateOnly(to);

    const locked = await this.prisma.attendancePeriod.findFirst({
      where: {
        status: PeriodStatus.LOCKED,
        // Overlap, the standard way: each range starts on or before the other
        // ends. Reversed arguments would only match periods *containing* the
        // whole range and would miss one that swallows half of it.
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: LOCKED_SELECT,
      orderBy: { startDate: 'asc' },
    });

    if (locked) throw new ConflictException(this.lockedMessage(locked));
  }

  /** `assertRangeOpen` for the callers that write one day. */
  async assertPeriodOpen(date: Date): Promise<void> {
    await this.assertRangeOpen(date, date);
  }

  /**
   * Which of these dates sit in a LOCKED period, as `yyyy-MM-dd` keys.
   *
   * The non-throwing variant, for the one caller that reports rather than
   * refuses — derivation, whose batch arrives off a device and may legitimately
   * straddle the lock boundary. See its call site for why that asymmetry exists.
   *
   * One query for the whole batch, resolved in memory afterwards. A per-date
   * check would put a round trip inside a planning loop that both derivation and
   * the close job promise, in comments, not to do.
   */
  async loadLockedDates(dates: Date[]): Promise<Set<string>> {
    if (dates.length === 0) return new Set();

    // A loop rather than `Math.min(...times)`: the spread form blows the stack
    // on a long enough list, and `deriveDays` takes an unbounded pair list
    // straight off a device batch.
    let from = toUtcDateOnly(dates[0]);
    let to = from;

    for (const date of dates) {
      const day = toUtcDateOnly(date);

      if (day.getTime() < from.getTime()) from = day;
      if (day.getTime() > to.getTime()) to = day;
    }

    const periods = await this.prisma.attendancePeriod.findMany({
      where: {
        status: PeriodStatus.LOCKED,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { startDate: true, endDate: true, status: true },
    });

    if (periods.length === 0) return new Set();

    return lockedDateKeys(periods, dates);
  }

  // -------------------------------------------------------------------- CRUD

  async create(dto: CreateAttendancePeriodDto) {
    const bounds = this.resolveBounds(dto);

    this.assertLabelMatchesEnd(dto.year, dto.month, bounds.endDate);
    this.assertLength(bounds);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Read-then-write, exactly as `PlannedAbsence` checks its overlap: a
          // range constraint needs a Postgres exclusion constraint, which Prisma
          // does not model. The `@@unique([year, month])` below still catches the
          // race this cannot.
          const clash = await tx.attendancePeriod.findFirst({
            where: {
              startDate: { lte: bounds.endDate },
              endDate: { gte: bounds.startDate },
            },
            select: LOCKED_SELECT,
          });

          if (clash) {
            throw new ConflictException(
              `Overlaps ${this.label(clash)} (${toDateKey(clash.startDate)} to ${toDateKey(clash.endDate)})`,
            );
          }

          return tx.attendancePeriod.create({
            data: {
              year: dto.year,
              month: dto.month,
              startDate: bounds.startDate,
              endDate: bounds.endDate,
            },
          });
        },
        { timeout: 15000, maxWait: 10000 },
      );
    } catch (error) {
      throw this.mapDuplicateLabel(error, dto.year, dto.month);
    }
  }

  async findAll(query: FindAttendancePeriodDto) {
    const { page, limit } = query;
    const { skip, take } = getPaginationParams({ page, limit });

    const where: Prisma.AttendancePeriodWhereInput = {
      ...(query.year !== undefined && { year: query.year }),
      ...(query.status && { status: query.status }),
    };

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.attendancePeriod.findMany({
          where,
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
          skip,
          take,
        }),
        this.prisma.attendancePeriod.count({ where }),
      ],
      { timeout: 15000, maxWait: 10000 },
    );

    return buildPaginatedResponse(data, total, page, limit);
  }

  async findOne(id: string) {
    const period = await this.prisma.attendancePeriod.findUnique({
      where: { id },
    });

    if (!period) throw new NotFoundException('Attendance period not found');

    return period;
  }

  // ----------------------------------------------------------------- helpers

  /**
   * Both bounds or neither — see the note on the DTO.
   *
   * `parseDateOnlyOrThrow` because the regex admits `2026-02-30`; left unhandled
   * the `RangeError` escapes `HttpExceptionFilter` as a 500 for plainly bad input.
   */
  private resolveBounds(dto: CreateAttendancePeriodDto): PeriodBounds {
    const hasStart = dto.startDate !== undefined;
    const hasEnd = dto.endDate !== undefined;

    if (hasStart !== hasEnd) {
      throw new BadRequestException(
        'Supply both startDate and endDate, or neither — a period with one bound is half a cycle',
      );
    }

    if (!hasStart || !hasEnd) {
      return calendarMonthWindow(dto.year, dto.month);
    }

    const startDate = parseDateOnlyOrThrow(dto.startDate!);
    const endDate = parseDateOnlyOrThrow(dto.endDate!);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate cannot be before startDate');
    }

    return { startDate, endDate };
  }

  /**
   * The label follows the *end* of the cycle (PRD §5.9): a 26-to-25 period ending
   * 25 Aug is August. Checking the end rather than the start is the only rule
   * that accepts both a calendar month and a shifted cycle while still catching a
   * period labelled with the wrong month entirely.
   */
  private assertLabelMatchesEnd(year: number, month: number, endDate: Date) {
    if (
      endDate.getUTCFullYear() !== year ||
      endDate.getUTCMonth() + 1 !== month
    ) {
      throw new BadRequestException(
        `A period labelled ${this.label({ year, month })} must end inside ${this.label({ year, month })} — the label follows the end of the cycle, not its start (endDate is ${toDateKey(endDate)})`,
      );
    }
  }

  /**
   * A typo'd year turns a period into a thirteen-month window that swallows every
   * date the guard is ever asked about, and it would look like a working lock
   * right up until payroll noticed August was closed in May. Forty-five days
   * leaves room for a first partial cycle without admitting anything absurd.
   */
  private assertLength(bounds: PeriodBounds) {
    const days =
      (bounds.endDate.getTime() - bounds.startDate.getTime()) / 86_400_000 + 1;

    if (days > MAX_PERIOD_DAYS) {
      throw new BadRequestException(
        `A period cannot run longer than ${MAX_PERIOD_DAYS} days (${toDateKey(bounds.startDate)} to ${toDateKey(bounds.endDate)} is ${days})`,
      );
    }
  }

  /**
   * Both the label and the bounds. On a 26-to-25 cycle "September 2026 is locked"
   * is baffling when the date you sent was 28 August; the range is what makes the
   * refusal comprehensible.
   */
  private lockedMessage(period: {
    year: number;
    month: number;
    startDate: Date;
    endDate: Date;
  }): string {
    return `${this.label(period)} is locked (${toDateKey(period.startDate)} to ${toDateKey(period.endDate)}) — attendance inside it cannot be changed`;
  }

  private label(period: { year: number; month: number }): string {
    return `${MONTH_LABELS[period.month - 1]} ${period.year}`;
  }

  /**
   * The unique constraint is the real duplicate check — the overlap read above
   * cannot see a period two concurrent creates are both about to insert.
   */
  private mapDuplicateLabel(error: unknown, year: number, month: number) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
    ) {
      return new ConflictException(
        `A period already exists for ${this.label({ year, month })}`,
      );
    }

    return error;
  }
}
