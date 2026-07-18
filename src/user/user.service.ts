import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';

type PrismaTransactionClient = Prisma.TransactionClient;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: { email: string; password: string; role?: Role },
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const hashedPassword = await bcrypt.hash(data.password, 10);

    return client.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        role: data?.role ?? Role.EMPLOYEE,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
