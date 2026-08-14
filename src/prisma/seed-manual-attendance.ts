import { PrismaClient } from '../generated/prisma/client.js';
import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../generated/prisma/enums.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Sets up the Phase 5 exit criterion by hand.
 *
 * HR marks somebody absent; a device then reports a punch for that same day.
 * The punch must be stored, the row must not move, and the contradiction must
 * be flagged. `attendance-derivation.service.spec.ts` proves it in isolation —
 * this makes the same scenario reproducible against the real database.
 *
 *   pnpm seed:manual-attendance WFM-EMP-001 2026-08-13
 *
 * Then POST /attendance/punches for that employee and day, and check the row:
 * status still ABSENT, source still MANUAL, checkIn/checkOut still null,
 * hasConflict true, and the punch present in AttendancePunch.
 */

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const [employeeCode, date] = process.argv.slice(2);

  if (!employeeCode || !date) {
    throw new Error(
      'Usage: pnpm seed:manual-attendance <employeeCode> <YYYY-MM-DD>',
    );
  }

  const attendanceDate = new Date(`${date}T00:00:00.000Z`);

  if (Number.isNaN(attendanceDate.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }

  const employee = await prisma.employee.findUnique({
    where: { employeeId: employeeCode },
    select: { id: true, fullName: true, shiftId: true },
  });

  if (!employee) {
    throw new Error(`No employee with code ${employeeCode}`);
  }

  if (!employee.shiftId) {
    // Derivation refuses a shiftless employee, so the punch would never reach
    // the precedence check and the scenario would prove nothing.
    throw new Error(
      `${employeeCode} has no shift assigned — derivation would skip the day`,
    );
  }

  const row = {
    shiftId: employee.shiftId,
    dayType: DayType.WORKING,
    status: AttendanceStatus.ABSENT,
    source: AttendanceSource.MANUAL,
    checkIn: null,
    checkOut: null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    hasConflict: false,
    conflictNote: null,
    remark: 'Marked absent by HR — Phase 5 exit criterion fixture',
  };

  const attendance = await prisma.attendance.upsert({
    where: {
      employeeId_attendanceDate: { employeeId: employee.id, attendanceDate },
    },
    create: { employeeId: employee.id, attendanceDate, ...row },
    update: row,
  });

  console.log(
    `Seeded MANUAL/ABSENT row ${attendance.id} for ${employee.fullName} (${employeeCode}) on ${date}.`,
  );
  console.log(
    'Now POST /attendance/punches for that employee and day. The row must not move.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
