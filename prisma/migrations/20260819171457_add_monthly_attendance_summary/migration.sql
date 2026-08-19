-- CreateTable
CREATE TABLE "MonthlyAttendanceSummary" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "eligibleDays" INTEGER NOT NULL,
    "presentDays" INTEGER NOT NULL,
    "halfDays" INTEGER NOT NULL,
    "absentDays" INTEGER NOT NULL,
    "paidLeaveDays" INTEGER NOT NULL,
    "unpaidLeaveDays" INTEGER NOT NULL,
    "holidayCount" INTEGER NOT NULL,
    "weeklyOffCount" INTEGER NOT NULL,
    "holidayWorkedDays" INTEGER NOT NULL,
    "weeklyOffWorkedDays" INTEGER NOT NULL,
    "totalWorkedMinutes" INTEGER NOT NULL,
    "totalLateMinutes" INTEGER NOT NULL,
    "totalEarlyExitMinutes" INTEGER NOT NULL,
    "normalOvertimeMinutes" INTEGER NOT NULL,
    "holidayOvertimeMinutes" INTEGER NOT NULL,
    "weeklyOffOvertimeMinutes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,

    CONSTRAINT "MonthlyAttendanceSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyAttendanceSummary_periodId_isCurrent_idx" ON "MonthlyAttendanceSummary"("periodId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyAttendanceSummary_employeeId_periodId_version_key" ON "MonthlyAttendanceSummary"("employeeId", "periodId", "version");

-- AddForeignKey
ALTER TABLE "MonthlyAttendanceSummary" ADD CONSTRAINT "MonthlyAttendanceSummary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyAttendanceSummary" ADD CONSTRAINT "MonthlyAttendanceSummary_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AttendancePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
