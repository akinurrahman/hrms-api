import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAnnouncementDto } from './dto/create-announcement.dto.js';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto.js';
import { FindAnnouncementDto } from './dto/find-announcement.dto.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';

@Injectable()
export class AnnouncementService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAnnouncementDto, postedByEmployeeId: string) {
    return await this.prisma.announcement.create({
      data: { ...dto, postedByEmployeeId },
    });
  }

  async findAll(query: FindAnnouncementDto) {
    const { pinned, page, limit } = query;
    const { skip, take } = getPaginationParams(query);

    console.log(typeof pinned, 'pinned value');

    const where: Prisma.AnnouncementWhereInput = {
      ...(pinned !== undefined && { pinned }),
    };

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.announcement.findMany({
          where,
          skip,
          take,
          orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
          include: {
            postedBy: {
              select: { id: true, employeeId: true, fullName: true },
            },
          },
        }),
        this.prisma.announcement.count({ where }),
      ],
      { timeout: 15000, maxWait: 10000 },
    );

    return buildPaginatedResponse(data, total, page, limit);
  }

  async findOne(id: string) {
    return await this.prisma.announcement.findUniqueOrThrow({
      where: { id },
      include: {
        postedBy: {
          select: { id: true, employeeId: true, fullName: true },
        },
      },
    });
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    return await this.prisma.announcement.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    return await this.prisma.announcement.delete({ where: { id } });
  }
}
