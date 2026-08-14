-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('WORKING', 'WEEKLY_OFF', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'NOT_APPLICABLE', 'MISSING_CHECKOUT');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('SYSTEM', 'DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "HolidayCompensation" AS ENUM ('PAID_EXTRA', 'COMP_OFF');

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "shiftId" TEXT,
    "dayType" "DayType" NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "source" "AttendanceSource" NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyExitMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "conflictNote" TEXT,
    "compensationType" "HolidayCompensation",
    "remark" TEXT,
    "markedById" TEXT,
    "plannedAbsenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attendance_attendanceDate_idx" ON "Attendance"("attendanceDate");

-- CreateIndex
CREATE INDEX "Attendance_attendanceDate_status_idx" ON "Attendance"("attendanceDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_attendanceDate_key" ON "Attendance"("employeeId", "attendanceDate");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
