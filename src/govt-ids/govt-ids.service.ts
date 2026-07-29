import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpsertGovtIdDto } from './dto/upsert-govt-id.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PrismaErrorCode } from '../common/index.js';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class GovtIdsService {
  constructor(private prisma: PrismaService) {}

  async upsert(employeeId: string, dto: UpsertGovtIdDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('No employee found');
    }

    try {
      return this.prisma.govtIds.upsert({
        where: { employeeId },
        create: { ...dto, employeeId },
        update: { ...dto },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PrismaErrorCode.UNIQUE_CONSTRAINT) {
          throw new ConflictException(
            'One of aadharNo, panNo, uanNo, or esicNo is already registered to another employee',
          );
        }
      }
      throw error;
    }
  }
}
