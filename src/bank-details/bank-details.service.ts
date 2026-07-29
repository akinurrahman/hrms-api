import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpsertBankDetailsDto } from './dto/upsert-bank-detail.dto.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';

@Injectable()
export class BankDetailsService {
  constructor(private prisma: PrismaService) {}

  async upsert(employeeId: string, dto: UpsertBankDetailsDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    try {
      return await this.prisma.bankDetails.upsert({
        where: { employeeId },
        create: { ...dto, employeeId },
        update: { ...dto },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PrismaErrorCode.UNIQUE_CONSTRAINT) {
          throw new ConflictException(
            'This bank account is already registered to another employee',
          );
        }
      }
      throw error;
    }
  }
}
