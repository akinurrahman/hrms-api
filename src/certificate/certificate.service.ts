import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpsertCertificateDto } from './dto/upsert-certificate.dto.js';
import { Certificate } from '../generated/prisma/client.js';

@Injectable()
export class CertificateService {
  constructor(private prisma: PrismaService) {}

  async upsert(employeeId: string, dto: UpsertCertificateDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return await this.prisma.$transaction(
      async (tx) => {
        // delete first so a deleted id can't collide with an update in the same call
        if (dto.deleteIds.length > 0) {
          await tx.certificate.deleteMany({
            where: {
              id: { in: dto.deleteIds },
              employeeId, // scoped, so employee A can't delete employee B's records
            },
          });
        }

        const results: Certificate[] = [];
        for (const item of dto.upsert) {
          const { id, issueDate, expiryDate, ...rest } = item;

          const data = {
            ...rest,
            issueDate: issueDate ? new Date(issueDate) : null,
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            employeeId,
          };

          if (id) {
            const updated = await tx.certificate.update({
              where: { id, employeeId },
              data,
            });
            results.push(updated);
          } else {
            const created = await tx.certificate.create({ data });
            results.push(created);
          }
        }

        return results;
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }
}
