import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpsertEducationDto } from './dto/upsert-education.dto.js';
import { Education } from '../generated/prisma/client.js';

@Injectable()
export class EducationService {
  constructor(private prisma: PrismaService) {}

  async upsert(employeeId: string, dto: UpsertEducationDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return await this.prisma.$transaction(
      async (tx) => {
        // delete first so that a deleted id can't collide with an update in the same call
        if (dto.deleteIds.length > 0) {
          await tx.education.deleteMany({
            where: {
              id: { in: dto.deleteIds },
              employeeId, // scoped, so employee A can't delete employee B's record
            },
          });
        }

        const result: Education[] = [];
        for (const item of dto.upsert) {
          const { id, startDate, endDate, ...rest } = item;
          const data = {
            ...rest,
            startDate: new Date(startDate),
            endDate: endDate ? new Date(endDate) : null,
            employeeId,
          };

          if (id) {
            const updated = await tx.education.update({
              where: { id, employeeId },
              data,
            });

            result.push(updated);
          } else {
            const created = await tx.education.create({ data });
            result.push(created);
          }
        }

        return result;
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }
}
