import { Prisma } from '../../generated/prisma/client.js';

/**
 * The columns a month's arithmetic reads, and nothing else.
 *
 * Shared by the monthly sheet and the month lock on purpose: they run the same
 * pure functions over the same rows, and the sheet promising HR one set of
 * totals while the lock writes payroll another is the failure mode this select
 * exists to make impossible.
 *
 * Deliberately narrow. A period is thirty-one days times the whole headcount, so
 * the fields nobody counts — remarks, conflict notes, timestamps, the shift —
 * are the difference between a query that fits in memory and one that does not.
 */
export const SUMMARY_ROW_SELECT = {
  id: true,
  employeeId: true,
  attendanceDate: true,
  dayType: true,
  status: true,
  workedMinutes: true,
  lateMinutes: true,
  earlyExitMinutes: true,
  overtimeMinutes: true,
  hasConflict: true,
  plannedAbsenceId: true,
} satisfies Prisma.AttendanceSelect;

export type SummaryAttendanceRow = Prisma.AttendanceGetPayload<{
  select: typeof SUMMARY_ROW_SELECT;
}>;
