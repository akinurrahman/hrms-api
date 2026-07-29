import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpsertEmploymentHistoryDto } from './dto/upsert-employment-history.dto.js';
import { EmploymentHistory } from '../generated/prisma/client.js';

@Injectable()
export class EmploymentHistoryService {
  constructor(private prisma: PrismaService) {}

  async upsert(employeeId: string, dto: UpsertEmploymentHistoryDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return await this.prisma.$transaction(
      async (tx) => {
        // Delete first, so a deleted id can't collide with an update in the same call
        if (dto.deleteIds.length > 0) {
          await tx.employmentHistory.deleteMany({
            where: {
              id: { in: dto.deleteIds },
              employeeId, // scoped, so employee A can't delete employee B's records
            },
          });
        }

        const results: EmploymentHistory[] = [];
        for (const item of dto.upsert) {
          const { id, startDate, endDate, ...rest } = item;

          const data = {
            ...rest,
            startDate: new Date(startDate),
            endDate: endDate ? new Date(endDate) : null,
            employeeId,
          };

          if (id) {
            const updated = await tx.employmentHistory.update({
              where: { id, employeeId }, // scoped, same reason as delete
              data,
            });
            results.push(updated);
          } else {
            const created = await tx.employmentHistory.create({ data });
            results.push(created);
          }
        }

        return results;
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }
}
