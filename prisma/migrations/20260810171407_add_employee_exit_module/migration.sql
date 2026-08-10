/*
  Warnings:

  - You are about to drop the column `exitReason` on the `Employee` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('RESIGNATION', 'TERMINATION', 'DISMISSAL', 'RETIREMENT', 'END_OF_CONTRACT', 'ABSCONDING', 'DEATH', 'OTHER');

-- CreateEnum
CREATE TYPE "ExitDocumentType" AS ENUM ('RESIGNATION_LETTER', 'TERMINATION_LETTER', 'RELIEVING_LETTER', 'EXPERIENCE_LETTER', 'FULL_AND_FINAL_SETTLEMENT', 'DEATH_CERTIFICATE', 'HANDOVER_CHECKLIST', 'OTHER');

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "exitReason";

-- CreateTable
CREATE TABLE "EmployeeExit" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exitType" "ExitType" NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "resignationDate" DATE,
    "noticePeriodDays" INTEGER,
    "isRehireEligible" BOOLEAN NOT NULL DEFAULT true,
    "rehireRemark" TEXT,
    "processedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeExit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitDocument" (
    "id" TEXT NOT NULL,
    "exitId" TEXT NOT NULL,
    "type" "ExitDocumentType" NOT NULL,
    "customName" TEXT,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeExit_employeeId_key" ON "EmployeeExit"("employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeExit" ADD CONSTRAINT "EmployeeExit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeExit" ADD CONSTRAINT "EmployeeExit_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitDocument" ADD CONSTRAINT "ExitDocument_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "EmployeeExit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
