-- CreateEnum
CREATE TYPE "PunchDirection" AS ENUM ('IN', 'OUT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "direction" "PunchDirection" NOT NULL DEFAULT 'UNKNOWN',
    "deviceId" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "rawPayload" JSONB,
    "attendanceDate" DATE,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "ignoreReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendancePunch_employeeId_punchedAt_idx" ON "AttendancePunch"("employeeId", "punchedAt");

-- CreateIndex
CREATE INDEX "AttendancePunch_isProcessed_idx" ON "AttendancePunch"("isProcessed");

-- CreateIndex
CREATE INDEX "AttendancePunch_attendanceDate_idx" ON "AttendancePunch"("attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePunch_employeeId_punchedAt_deviceId_key" ON "AttendancePunch"("employeeId", "punchedAt", "deviceId");

-- AddForeignKey
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
