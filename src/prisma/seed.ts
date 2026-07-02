import { PrismaClient, Role } from '../generated/prisma/client.js';
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
      fullName: 'Site Admin',
      password: hashedPassword,
      role: Role.SITE_ADMIN,
    },
  });

  console.log('Seeded user:', user.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
