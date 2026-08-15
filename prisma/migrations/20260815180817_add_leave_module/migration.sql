-- CreateEnum
CREATE TYPE "PlannedAbsenceStatus" AS ENUM ('APPROVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL,
    "isEncashable" BOOLEAN NOT NULL DEFAULT false,
    "expiryDays" INTEGER,
    "maxPerYear" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedAbsence" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "status" "PlannedAbsenceStatus" NOT NULL DEFAULT 'APPROVED',
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");

-- CreateIndex
CREATE INDEX "PlannedAbsence_employeeId_startDate_endDate_idx" ON "PlannedAbsence"("employeeId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_plannedAbsenceId_fkey" FOREIGN KEY ("plannedAbsenceId") REFERENCES "PlannedAbsence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedAbsence" ADD CONSTRAINT "PlannedAbsence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedAbsence" ADD CONSTRAINT "PlannedAbsence_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the leave types.
--
-- Here rather than in `src/prisma/seed.ts` because these are configuration, not
-- fixtures: every environment needs the same five codes, and they must survive a
-- `migrate reset` without a separate step. `gen_random_uuid()` because Prisma's
-- uuid default is generated application-side and is not available to raw SQL.
--
-- ON CONFLICT DO NOTHING so re-running against a database that already has them
-- is a no-op rather than a failed migration.
INSERT INTO "LeaveType" ("id", "code", "name", "isPaid", "isEncashable", "expiryDays", "updatedAt")
VALUES
    (gen_random_uuid(), 'EL', 'Earned Leave', true, true, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'CL', 'Casual Leave', true, false, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'SL', 'Sick Leave', true, false, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'COMP_OFF', 'Compensatory Off', true, false, 90, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'LWP', 'Leave Without Pay', false, false, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
