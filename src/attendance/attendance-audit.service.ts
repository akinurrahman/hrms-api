import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PaginationQueryDto } from '../common/index.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';

/**
 * The fields a manual write can touch, and therefore the only ones worth
 * snapshotting. `id`, `employeeId` and the timestamps are constant across a
 * row's whole history — repeating them in every entry adds bulk and answers
 * nothing.
 */
const AUDITED_FIELDS = [
  'dayType',
  'status',
  'source',
  'checkIn',
  'checkOut',
  'workedMinutes',
  'lateMinutes',
  'earlyExitMinutes',
  'overtimeMinutes',
  'compensationType',
  'hasConflict',
  'conflictNote',
  'remark',
  'shiftId',
] as const;

type AuditedField = (typeof AUDITED_FIELDS)[number];

/** Anything carrying the audited fields — a stored row or a planned write. */
export type AuditSnapshotSource = Partial<Record<AuditedField, unknown>>;

export interface AuditEntry {
  attendanceId: string;
  changedById: string;
  /** `null` when the row did not exist — the entry then reads as a creation. */
  before: AuditSnapshotSource | null;
  after: AuditSnapshotSource;
  remark?: string;
}

/**
 * The change history behind every manual attendance edit.
 *
 * `Attendance.markedById` answers "who touched this last", which is the wrong
 * question. HR edits the same day more than once, and a payroll dispute three
 * months later needs the sequence: what the row said before, what it says now,
 * and the reason given each time.
 *
 * Writes are handed back as unexecuted Prisma promises rather than awaited here,
 * so they join the same transaction as the attendance rows they describe. A log
 * that can commit without its row, or a row that can commit without its log, is
 * not an audit trail.
 */
@Injectable()
export class AttendanceAuditService {
  constructor(private readonly prisma: PrismaService) {}

  buildLogWrites(entries: AuditEntry[]): Prisma.PrismaPromise<unknown>[] {
    if (entries.length === 0) return [];

    return [
      this.prisma.attendanceAuditLog.createMany({
        data: entries.map((entry) => ({
          attendanceId: entry.attendanceId,
          changedById: entry.changedById,
          before: snapshot(entry.before),
          after: snapshot(entry.after),
          remark: entry.remark,
        })),
      }),
    ];
  }

  async findForAttendance(attendanceId: string, query: PaginationQueryDto) {
    const { page, limit } = query;
    const { take, skip } = getPaginationParams({ page, limit });

    // 404 rather than an empty page: "this row has no history" and "this row
    // does not exist" are different answers and only one of them is reassuring.
    const attendance = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      select: { id: true },
    });

    if (!attendance) throw new NotFoundException('Attendance record not found');

    const where: Prisma.AttendanceAuditLogWhereInput = { attendanceId };

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.attendanceAuditLog.findMany({
        where,
        // Newest first: the current state is what a dispute starts from, and
        // the history is read backwards from there.
        orderBy: { changedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.attendanceAuditLog.count({ where }),
    ]);

    return buildPaginatedResponse(logs, total, page, limit);
  }
}

/**
 * `{}` for a row that did not exist, so a creation is distinguishable from a
 * change that happened to touch nothing.
 *
 * Dates are serialised to ISO strings. Prisma would store a `Date` in a `Json`
 * column as a string anyway; doing it here means the value read back has the
 * same shape as the value written, instead of depending on which side of the
 * driver you look from.
 */
function snapshot(source: AuditSnapshotSource | null): Prisma.InputJsonObject {
  if (!source) return {};

  const result: Record<string, unknown> = {};

  for (const field of AUDITED_FIELDS) {
    const value = source[field];

    if (value === undefined) continue;

    result[field] = value instanceof Date ? value.toISOString() : value;
  }

  return result as Prisma.InputJsonObject;
}
