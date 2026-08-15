-- CreateTable
CREATE TABLE "AttendanceAuditLog" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "remark" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceAuditLog_attendanceId_idx" ON "AttendanceAuditLog"("attendanceId");

-- CreateIndex
CREATE INDEX "AttendanceAuditLog_changedById_changedAt_idx" ON "AttendanceAuditLog"("changedById", "changedAt");

-- AddForeignKey
ALTER TABLE "AttendanceAuditLog" ADD CONSTRAINT "AttendanceAuditLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
