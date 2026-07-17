import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateDesignationDto } from './dto/create-designation.dto.js';
import { UpdateDesignationDto } from './dto/update-designation.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { FindDesignationDto } from './dto/find-designation.dto.js';
import { PrismaErrorCode } from '../common/index.js';

@Injectable()
export class DesignationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDesignationDto: CreateDesignationDto) {
    try {
      return await this.prisma.designation.create({
        data: createDesignationDto,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code == PrismaErrorCode.UNIQUE_CONSTRAINT
      ) {
        throw new ConflictException(
          'A designation with this title already exists',
        );
      }
      throw error;
    }
  }

  async findAll(query: FindDesignationDto) {
    const { category } = query;
    return await this.prisma.designation.findMany({
      where: category ? { category } : undefined,
      orderBy: { title: 'asc' },
    });
  }

  async findOne(id: string) {
    const designations = await this.prisma.designation.findUnique({
      where: { id },
    });

    if (!designations) {
      throw new NotFoundException('Designation not found');
    }

    return designations;
  }

  async update(id: string, updateDesignationDto: UpdateDesignationDto) {
    try {
      return await this.prisma.designation.update({
        where: { id },
        data: updateDesignationDto,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PrismaErrorCode.NOT_FOUND) {
          throw new NotFoundException('Designation not found!');
        }
        if (error.code === PrismaErrorCode.UNIQUE_CONSTRAINT) {
          throw new ConflictException(
            'A designation with this title already exists',
          );
        }
      }
      throw error;
    }
  }

  async remove(id: string) {
    const employeeCount = await this.prisma.employee.count({
      where: {
        designationId: id,
      },
    });

    if (employeeCount > 0) {
      throw new ConflictException(
        'Cannot delete designation with employees assigned to it',
      );
    }

    try {
      return await this.prisma.designation.delete({
        where: { id },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCode.NOT_FOUND
      ) {
        throw new NotFoundException('Designation not found');
      }
      throw error;
    }
  }
}
