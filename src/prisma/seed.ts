import {
  PrismaClient,
  Role,
  DesignationCategory,
  EmployeeType,
  Gender,
} from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const hashedPassword = await bcrypt.hash('Pa$$w0rd!', 10);

  const user = await prisma.user.create({
    data: {
      email: 'admin@hrms.com',
      password: hashedPassword,
      role: Role.SITE_ADMIN,
    },
  });

  // ensure an admin-suitable designation exists
  const designation = await prisma.designation.upsert({
    where: { title: 'Site Administrator' },
    update: {},
    create: {
      title: 'Site Administrator',
      category: DesignationCategory.ADMIN,
    },
  });

  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      employeeId: 'WFM-ADMIN-01',
      fullName: 'System Admin',
      phoneNumber: '9999999999',
      dateOfBirth: new Date('1990-01-01'),
      gender: Gender.OTHER,
      employeeType: EmployeeType.HIGHLY_SKILLED,
      designationId: designation.id,
      dateOfJoining: new Date(),
      commAddressLine: 'N/A',
      commCity: 'N/A',
      commState: 'N/A',
      commPin: '000000',
      commCountry: 'India',
      permAddressLine: 'N/A',
      permCity: 'N/A',
      permState: 'N/A',
      permPin: '000000',
      permCountry: 'India',
    },
  });

  console.log('Seeded user:', user.email);
  console.log('Seeded employee:', employee.employeeId);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
