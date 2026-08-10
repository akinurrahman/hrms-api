-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastWorkingDay" DATE;
