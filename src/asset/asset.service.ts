import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';
import { FindAssetDto } from './dto/find-asset.dto.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';

@Injectable()
export class AssetService {
  constructor(private prisma: PrismaService) {}
  async create(createAssetDto: CreateAssetDto) {
    try {
      return await this.prisma.asset.create({
        data: createAssetDto,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PrismaErrorCode.UNIQUE_CONSTRAINT) {
          throw new ConflictException('An asset with this tag already exists');
        }
        if (error.code === PrismaErrorCode.FOREIGN_KEY_CONSTRAINT) {
          throw new ConflictException('Assigned employee does not exist');
        }
      }
      throw error;
    }
  }

  async findAll(query: FindAssetDto, restrictToEmployeeId?: string) {
    const { status, search, page, limit, category } = query;
    const where: Prisma.AssetWhereInput = {
      ...(status && { status }),
      ...(category && { category }),
      ...((restrictToEmployeeId ?? query.assignedToEmployeeId) && {
        assignedToEmployeeId:
          restrictToEmployeeId ?? query.assignedToEmployeeId,
      }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { assetTag: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const { take, skip } = getPaginationParams({ page, limit });

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.asset.findMany({
          where,
          include: {
            assignedTo: {
              select: {
                id: true,
                fullName: true,
                phoneNumber: true,
                employeeId: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take,
          skip,
        }),
        this.prisma.asset.count({ where }),
      ],
      { maxWait: 10000, timeout: 15000 },
    );

    return buildPaginatedResponse(data, total, page, limit);
  }
  
  async findOne(id: string, requestingEmployeeId?: string, isAdmin?: boolean) {
    const asset = await this.prisma.asset.findUniqueOrThrow({
      where: { id },
      include: {
        assignedTo: {
          select: {
            id: true,
            employeeId: true,
            fullName: true,
            phoneNumber: true,
          },
        },
      },
    });

    const isOwnedByOthers =
      asset.assignedToEmployeeId &&
      asset.assignedToEmployeeId !== requestingEmployeeId;

    if (!isAdmin && isOwnedByOthers) {
      throw new NotFoundException('Asset not found');
    }

    return asset;
  }

  async update(id: string, updateAssetDto: UpdateAssetDto) {
    try {
      return await this.prisma.asset.update({
        where: { id },
        data: updateAssetDto,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
      ) {
        throw new ConflictException('Asset tag already exists');
      }
      throw error;
    }
  }
  async remove(id: string) {
    return await this.prisma.asset.delete({
      where: { id },
    });
  }
}
