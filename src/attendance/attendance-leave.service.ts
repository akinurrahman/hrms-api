import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { PlannedAbsenceStatus } from '../generated/prisma/enums.js';
import { toUtcDateOnly } from '../common/utils/date.js';
import {
  AttendanceAuditService,
  AuditEntry,
} from './attendance-audit.service.js';
import { planLeaveConversion } from './utils/leave-conversion.js';
import { planLeaveReversion } from './utils/leave-reversion.js';

/** Prisma's transaction client, for callers that own the transaction. */
type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

const ABSENCE_SELECT = {
  id: true,
  employeeId: true,
  startDate: true,
  endDate: true,
  isHalfDay: true,
  leaveType: { select: { id: true, code: true, name: true, isPaid: true } },
} satisfies Prisma.PlannedAbsenceSelect;

export type ApprovedAbsence = Prisma.PlannedAbsenceGetPayload<{
  select: typeof ABSENCE_SELECT;
}>;

export interface ConversionSummary {
  converted: number;
  conflicted: number;
}

export interface ReversionSummary {
  reverted: number;
  conflicted: number;
}

/**
 * The seam between attendance and leave.
 *
 * Every question attendance asks about leave goes through here — the roster's
 * display state, the manual override's backing record, and the nightly close
 * job's absent detection. One definition rather than one per caller, so when the
 * real leave module replaces `PlannedAbsence` there is a single file to change
 * instead of three call sites that have quietly drifted apart.
 *
 * It lives in the attendance module rather than the leave module on purpose.
 * Attendance is the party that needs to *read* leave, and the leave module needs
 * to write attendance rows on approval. Putting the seam here keeps that
 * dependency pointing one way — `LeaveModule` imports `AttendanceModule`, never
 * the reverse — instead of two modules that cannot be constructed without each
 * other.
 */
@Injectable()
export class AttendanceLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AttendanceAuditService,
  ) {}

  /**
   * PRD §6.4's named seam: is this employee on approved leave on this date?
   *
   * Single-employee, for the close job's per-employee loop. The roster uses
   * `findApprovedForDate`, which asks the same question of a whole page in one
   * query.
   */
  async resolveLeaveForDate(
    employeeId: string,
    date: Date,
  ): Promise<ApprovedAbsence | null> {
    const found = await this.findApprovedForDate([employeeId], date);

    return found.get(employeeId) ?? null;
  }

  /**
   * The same question asked of many employees at once, mirroring
   * `HolidayService.findDateKeysIn`. The roster resolves a whole page, and a
   * query per row would be a round trip per employee.
   *
   * Overlap rather than equality: an absence covers a date when it starts on or
   * before it and ends on or after it.
   */
  async findApprovedForDate(
    employeeIds: string[],
    date: Date,
  ): Promise<Map<string, ApprovedAbsence>> {
    const byEmployee = new Map<string, ApprovedAbsence>();

    if (employeeIds.length === 0) return byEmployee;

    const target = toUtcDateOnly(date);

    const absences = await this.prisma.plannedAbsence.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: PlannedAbsenceStatus.APPROVED,
        startDate: { lte: target },
        endDate: { gte: target },
      },
      select: ABSENCE_SELECT,
    });

    for (const absence of absences) {
      byEmployee.set(absence.employeeId, absence);
    }

    return byEmployee;
  }

  /**
   * Apply an approved absence to the attendance rows that already exist for the
   * days it covers.
   *
   * Takes the caller's transaction client rather than opening its own: the
   * absence and the rows it converts have to land together. An absence that
   * committed without its conversions leaves days recorded as ABSENT that were
   * approved leave, and nothing afterwards knows to go back and fix them.
   *
   * Which rows may be touched is `planLeaveConversion`'s call, and it is pure —
   * this method only reads, writes, and audits.
   */
  async applyToExistingDays(
    tx: PrismaTx,
    input: {
      absenceId: string;
      employeeId: string;
      startDate: Date;
      endDate: Date;
      leaveCode: string;
      actorId: string;
    },
  ): Promise<ConversionSummary> {
    const rows = await tx.attendance.findMany({
      where: {
        employeeId: input.employeeId,
        attendanceDate: { gte: input.startDate, lte: input.endDate },
      },
    });

    const plan = planLeaveConversion({
      rows,
      absenceId: input.absenceId,
      leaveCode: input.leaveCode,
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const auditEntries: AuditEntry[] = [];

    for (const { attendanceId, data } of plan.converted) {
      await tx.attendance.update({ where: { id: attendanceId }, data });

      auditEntries.push({
        attendanceId,
        changedById: input.actorId,
        before: byId.get(attendanceId) ?? null,
        after: data,
        remark: `Converted to leave by approved ${input.leaveCode}`,
      });
    }

    for (const { attendanceId, data } of plan.conflicted) {
      await tx.attendance.update({ where: { id: attendanceId }, data });

      auditEntries.push({
        attendanceId,
        changedById: input.actorId,
        before: byId.get(attendanceId) ?? null,
        after: data,
        remark: data.conflictNote,
      });
    }

    // Audited on the same terms as a manual edit. A payroll dispute three months
    // out needs to see that the day flipped to ON_LEAVE because a leave was
    // approved on a specific date by a specific person, not merely that it is
    // ON_LEAVE now.
    for (const write of this.auditService.buildLogWrites(auditEntries, tx)) {
      await write;
    }

    return {
      converted: plan.converted.length,
      conflicted: plan.conflicted.length,
    };
  }

  /**
   * Undo an absence that has been withdrawn, on the days it already converted.
   *
   * The mirror of `applyToExistingDays`, and it exists for the same reason:
   * approval reaching backwards is only half a feature. A leave that flipped
   * Tuesday to ON_LEAVE and is then cancelled leaves Tuesday claiming an
   * authorisation that no longer exists, and payroll has no way to notice.
   *
   * Takes the caller's transaction client for the same reason too — an absence
   * that committed as CANCELLED without its reversions is the same broken state
   * as an approval without its conversions, just in the other direction.
   *
   * **It reverts to ABSENT and stops there.** PRD §6.5 also wants PRESENT where
   * punches exist, and that is deliberately not decided here: the punch log is
   * append-only, so the caller re-derives afterwards and DEVICE beats SYSTEM on
   * its own. Guessing at it here would be a second implementation of
   * `aggregate()` written from memory.
   */
  async revertCancelledAbsence(
    tx: PrismaTx,
    input: {
      absenceId: string;
      employeeId: string;
      startDate: Date;
      endDate: Date;
      leaveCode: string;
      actorId: string;
    },
  ): Promise<ReversionSummary> {
    // Filtered on the link rather than only the dates: a row charged to this
    // absence is this absence's to take back, and one that is not never is.
    const rows = await tx.attendance.findMany({
      where: {
        employeeId: input.employeeId,
        attendanceDate: { gte: input.startDate, lte: input.endDate },
        plannedAbsenceId: input.absenceId,
      },
    });

    const plan = planLeaveReversion({
      rows,
      absenceId: input.absenceId,
      leaveCode: input.leaveCode,
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const auditEntries: AuditEntry[] = [];

    for (const { attendanceId, data } of plan.reverted) {
      await tx.attendance.update({ where: { id: attendanceId }, data });

      auditEntries.push({
        attendanceId,
        changedById: input.actorId,
        before: byId.get(attendanceId) ?? null,
        after: data,
        remark: `Reverted: covering ${input.leaveCode} was cancelled`,
      });
    }

    for (const { attendanceId, data } of plan.conflicted) {
      await tx.attendance.update({ where: { id: attendanceId }, data });

      auditEntries.push({
        attendanceId,
        changedById: input.actorId,
        before: byId.get(attendanceId) ?? null,
        after: data,
        remark: data.conflictNote,
      });
    }

    for (const write of this.auditService.buildLogWrites(auditEntries, tx)) {
      await write;
    }

    return {
      reverted: plan.reverted.length,
      conflicted: plan.conflicted.length,
    };
  }
}
