import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The leave catalogue.
 *
 * Read-only, and that is the design rather than an omission. Leave types are
 * configuration: the five codes are seeded by the migration that created the
 * table, every environment has the same set, and adding a sixth is a schema
 * change reviewed like one. Exposing create and delete would let a live database
 * drift from every other one, and deleting a type that days already point at is
 * not a thing the module should make easy.
 */
@Injectable()
export class LeaveTypeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Unpaginated, like the holiday year: this is a dropdown's contents, and there
   * will never be enough of them for a page to mean anything.
   *
   * Active only — a retired type must stay readable on the leave records that
   * already reference it, but must not be offered for new ones.
   */
  async findAll() {
    const data = await this.prisma.leaveType.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    return { count: data.length, data };
  }
}
