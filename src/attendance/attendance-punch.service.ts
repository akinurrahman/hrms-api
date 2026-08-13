import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PunchDirection } from '../generated/prisma/enums.js';
import { PrismaErrorCode } from '../common/index.js';
import { toUtcDateOnly } from '../common/utils/date.js';
import { isEmployeeEligibleOn } from '../common/utils/employee-eligibility.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import { PunchIgnoreReason } from './constants/punch-ignore-reason.constant.js';
import { resolvePunchDate } from './utils/resolve-punch-date.js';
import { CreatePunchBatchDto, PunchItemDto } from './dto/create-punch.dto.js';
import { FindPunchDto } from './dto/find-punch.dto.js';

/** Sentinel for a device that did not identify itself — see the schema comment. */
const UNKNOWN_DEVICE = 'UNKNOWN';

/** The employee facts ingestion needs, loaded once per batch. */
type IngestEmployee = {
  id: string;
  employeeId: string;
  dateOfJoining: Date;
  lastWorkingDay: Date | null;
  shift: {
    startMinutes: number;
    endMinutes: number;
  } | null;
};

export interface RejectedPunch {
  /** Index into the submitted array, so the device can point at the offender. */
  index: number;
  employeeCode: string;
  reason: string;
}

@Injectable()
export class AttendancePunchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AttendancePolicyService,
  ) {}

  /**
   * Store a batch of raw punches, attributing each to the day it belongs to.
   *
   * Nothing is derived here. No `Attendance` row is written, no direction is
   * inferred, no status is decided — this is the append-only layer that all of
   * that is later recomputed from, and it stays boring on purpose.
   *
   * **Partial acceptance is deliberate, and it contradicts the bulk override
   * path on purpose.** A bulk override is a human writing a payroll input, so
   * all-or-nothing is right there. This is a device feed: rejecting two hundred
   * good punches because one badge is unenrolled means the device retries the
   * whole batch forever and nothing ever lands. Rejects are reported by index
   * instead, so nothing is lost silently.
   */
  async ingest(dto: CreatePunchBatchDto) {
    const policy = await this.policyService.get();

    const employees = await this.loadEmployees(dto.punches);

    const rows: Prisma.AttendancePunchCreateManyInput[] = [];
    const rejected: RejectedPunch[] = [];

    dto.punches.forEach((punch, index) => {
      const employee = employees.get(punch.employeeCode);

      if (!employee) {
        // Not stored: there is no employee row to hang the foreign key on.
        rejected.push({
          index,
          employeeCode: punch.employeeCode,
          reason: 'UNKNOWN_EMPLOYEE_CODE',
        });
        return;
      }

      rows.push(this.buildRow(punch, employee, policy));
    });

    // `skipDuplicates` over the unique key is the whole idempotency story —
    // no read-then-write, no transaction. Replaying a batch is free.
    const { count } = await this.create(rows);

    return {
      received: dto.punches.length,
      inserted: count,
      duplicates: rows.length - count,
      unresolved: rows.filter((row) => row.attendanceDate === null).length,
      rejected,
    };
  }

  async findAll(query: FindPunchDto) {
    const { page, limit } = query;
    const { skip, take } = getPaginationParams(query);

    const where = this.buildWhere(query);

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.attendancePunch.findMany({
          where,
          skip,
          take,
          orderBy: [{ punchedAt: 'desc' }],
          include: {
            employee: { select: { employeeId: true, fullName: true } },
          },
        }),
        this.prisma.attendancePunch.count({ where }),
      ],
      { timeout: 15000, maxWait: 10000 },
    );

    return buildPaginatedResponse(data, total, page, limit);
  }

  /**
   * One query for the whole batch. A lookup per punch would be a round trip
   * per punch, and a device that has been offline sends hundreds at once.
   */
  private async loadEmployees(punches: PunchItemDto[]) {
    const codes = [...new Set(punches.map((punch) => punch.employeeCode))];

    const employees = await this.prisma.employee.findMany({
      where: { employeeId: { in: codes } },
      select: {
        id: true,
        employeeId: true,
        dateOfJoining: true,
        lastWorkingDay: true,
        shift: { select: { startMinutes: true, endMinutes: true } },
      },
    });

    return new Map<string, IngestEmployee>(
      employees.map((employee) => [employee.employeeId, employee]),
    );
  }

  /**
   * Classify one punch. Every branch below still stores the row — "ignored"
   * means excluded from the arithmetic, never discarded. The raw layer is
   * append-only, and each of these is something HR can be shown.
   */
  private buildRow(
    punch: PunchItemDto,
    employee: IngestEmployee,
    policy: Awaited<ReturnType<AttendancePolicyService['get']>>,
  ): Prisma.AttendancePunchCreateManyInput {
    const base = {
      employeeId: employee.id,
      punchedAt: this.parseInstant(punch.punchedAt),
      direction: punch.direction ?? PunchDirection.UNKNOWN,
      deviceId: punch.deviceId ?? UNKNOWN_DEVICE,
      ...(punch.rawPayload && {
        rawPayload: punch.rawPayload as Prisma.InputJsonValue,
      }),
      // Always false. Derivation owns this flag; ingestion only fills its queue.
      isProcessed: false,
    };

    // PRD §9 case 13. Defaulting to an assumed 9-to-6 would produce
    // plausible-looking wrong numbers, which is worse than refusing to answer.
    if (!employee.shift) {
      return {
        ...base,
        attendanceDate: null,
        isIgnored: true,
        ignoreReason: PunchIgnoreReason.NO_SHIFT_ASSIGNED,
      };
    }

    const resolved = resolvePunchDate({
      punchedAt: base.punchedAt,
      shift: employee.shift,
      policy,
    });

    if (resolved.attendanceDate === null) {
      return {
        ...base,
        attendanceDate: null,
        isIgnored: true,
        ignoreReason: resolved.reason,
      };
    }

    // A leaver's badge still being swiped, or a punch dated before they
    // joined. It resolved cleanly to a day — just not one they worked.
    if (!isEmployeeEligibleOn(employee, resolved.attendanceDate)) {
      return {
        ...base,
        attendanceDate: resolved.attendanceDate,
        isIgnored: true,
        ignoreReason: PunchIgnoreReason.NOT_ON_ROLLS,
      };
    }

    return { ...base, attendanceDate: resolved.attendanceDate };
  }

  private async create(rows: Prisma.AttendancePunchCreateManyInput[]) {
    if (rows.length === 0) return { count: 0 };

    try {
      return await this.prisma.attendancePunch.createMany({
        data: rows,
        skipDuplicates: true,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCode.FOREIGN_KEY_CONSTRAINT
      ) {
        // Only reachable if an employee was deleted between the lookup above
        // and this write.
        throw new BadRequestException(
          'One or more punches reference an employee that no longer exists',
        );
      }
      throw error;
    }
  }

  private buildWhere(query: FindPunchDto): Prisma.AttendancePunchWhereInput {
    const { employeeCode, from, to, attendanceDate, isProcessed, isIgnored } =
      query;

    return {
      ...(employeeCode && { employee: { employeeId: employeeCode } }),
      ...((from ?? to) && {
        punchedAt: {
          ...(from && { gte: this.parseInstant(from) }),
          ...(to && { lte: this.parseInstant(to) }),
        },
      }),
      ...(attendanceDate && {
        attendanceDate: this.parseDateOnly(attendanceDate),
      }),
      ...(isProcessed !== undefined && { isProcessed }),
      ...(isIgnored !== undefined && { isIgnored }),
      // Deliberately last, and deliberately not merged with `attendanceDate`
      // above — asking for both is a contradiction the caller should see as an
      // empty result, not as one filter silently winning.
      ...(query.unresolved !== undefined && {
        attendanceDate: query.unresolved ? null : { not: null },
      }),
    };
  }

  private parseInstant(input: string): Date {
    const parsed = new Date(input);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid timestamp: ${input}`);
    }

    return parsed;
  }

  /**
   * `toUtcDateOnly` throws `RangeError` for a shape the DTO allows but the
   * calendar does not — `2026-02-30`. Unhandled it escapes
   * `HttpExceptionFilter`, which only catches `HttpException`, and surfaces as
   * a 500 for what is plainly bad input.
   */
  private parseDateOnly(input: string): Date {
    try {
      return toUtcDateOnly(input);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
