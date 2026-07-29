import { Injectable, NotFoundException } from '@nestjs/common';
import { UpsertFamilyInfoDto } from './dto/upsert-family-info.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class FamilyInfoService {
  constructor(private prisma: PrismaService) {}

  async upsert(employeeId: string, dto: UpsertFamilyInfoDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return await this.prisma.familyInfo.upsert({
      where: { employeeId },
      create: { ...dto, employeeId },
      update: { ...dto },
    });
  }
}
