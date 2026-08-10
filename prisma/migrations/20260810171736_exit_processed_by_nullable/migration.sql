-- DropForeignKey
ALTER TABLE "EmployeeExit" DROP CONSTRAINT "EmployeeExit_processedById_fkey";

-- AlterTable
ALTER TABLE "EmployeeExit" ALTER COLUMN "processedById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "EmployeeExit" ADD CONSTRAINT "EmployeeExit_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
