-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('HIGHLY_SKILLED', 'SKILLED', 'SEMI_SKILLED', 'UNSKILLED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "DesignationCategory" AS ENUM ('HR', 'SUPERVISOR', 'TECHNICIAN', 'ADMIN', 'GENERAL');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- CreateEnum
CREATE TYPE "EmergencyContactRelation" AS ENUM ('FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'UNCLE', 'AUNT', 'SPOUSE', 'FRIEND', 'COUSIN');

-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('DAILY', 'MONTHLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('AADHAR_CARD', 'PAN_CARD', 'BANK_PASSBOOK', 'NOC', 'OTHER');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "alternateNumber" TEXT,
    "dateOfBirth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "employeeType" "EmployeeType" NOT NULL,
    "designationId" TEXT NOT NULL,
    "dateOfJoining" DATE NOT NULL,
    "commAddressLine" TEXT NOT NULL,
    "commCity" TEXT NOT NULL,
    "commState" TEXT NOT NULL,
    "commPin" TEXT NOT NULL,
    "commCountry" TEXT NOT NULL,
    "permAddressLine" TEXT NOT NULL,
    "permCity" TEXT NOT NULL,
    "permState" TEXT NOT NULL,
    "permPin" TEXT NOT NULL,
    "permCountry" TEXT NOT NULL,
    "sameAsPermanent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "DesignationCategory" NOT NULL,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyInfo" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fathersName" TEXT NOT NULL,
    "mothersName" TEXT NOT NULL,
    "maritalStatus" "MaritalStatus" NOT NULL,
    "spouseName" TEXT,
    "emergencyContactName" TEXT NOT NULL,
    "emergencyContactNumber" TEXT NOT NULL,
    "emergencyContactRelation" "EmergencyContactRelation" NOT NULL,
    "emergencyContactAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovtIds" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "aadharNo" TEXT NOT NULL,
    "panNo" TEXT NOT NULL,
    "uanNo" TEXT,
    "esicNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovtIds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDetails" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isCurrentlyWorking" BOOLEAN NOT NULL DEFAULT false,
    "jobResponsibilities" TEXT,
    "salary" DECIMAL(10,2),
    "salaryPeriod" "SalaryPeriod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "instituteName" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isCurrentlyStudying" BOOLEAN NOT NULL DEFAULT false,
    "passingYear" INTEGER,
    "divisionGrade" TEXT,
    "marksObtained" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "certificateName" TEXT NOT NULL,
    "issuingOrg" TEXT NOT NULL,
    "topicDescription" TEXT,
    "certificateUrl" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "customName" TEXT,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_phoneNumber_key" ON "Employee"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_title_key" ON "Designation"("title");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyInfo_employeeId_key" ON "FamilyInfo"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "GovtIds_employeeId_key" ON "GovtIds"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "GovtIds_aadharNo_key" ON "GovtIds"("aadharNo");

-- CreateIndex
CREATE UNIQUE INDEX "GovtIds_panNo_key" ON "GovtIds"("panNo");

-- CreateIndex
CREATE UNIQUE INDEX "GovtIds_uanNo_key" ON "GovtIds"("uanNo");

-- CreateIndex
CREATE UNIQUE INDEX "GovtIds_esicNo_key" ON "GovtIds"("esicNo");

-- CreateIndex
CREATE UNIQUE INDEX "BankDetails_employeeId_key" ON "BankDetails"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "BankDetails_bankName_accountNo_key" ON "BankDetails"("bankName", "accountNo");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyInfo" ADD CONSTRAINT "FamilyInfo_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovtIds" ADD CONSTRAINT "GovtIds_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetails" ADD CONSTRAINT "BankDetails_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentHistory" ADD CONSTRAINT "EmploymentHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Education" ADD CONSTRAINT "Education_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
