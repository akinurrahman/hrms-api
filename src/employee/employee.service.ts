import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';
import { UserService } from '../user/user.service.js';
import { randomBytes } from 'crypto';
import { FindEmployeeDto } from './dto/find-employee.dto.js';
import {
  buildPaginatedResponse,
  getPaginationParams,
} from '../common/utils/paginate.js';
import { employeeEligibleOn } from '../common/utils/employee-eligibility.js';
import { toUtcDateOnly } from '../common/utils/date.js';

type PrismaTransactionClient = Prisma.TransactionClient;

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}
  async create(createEmployeeDto: CreateEmployeeDto) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const tempPassword = this.generateTempPassword();

          // TODO: send tempPassword to dto.email via email service instead of logging
          // TODO: add a "must change password on first login" flag on User once email delivery is in place
          console.log(
            `[DEV ONLY] Temp password for ${createEmployeeDto.email}: ${tempPassword}`,
          );

          const { email, ...employeeFields } = createEmployeeDto;
          const user = await this.userService.create(
            { email, password: tempPassword },
            tx,
          );

          const employeeId = await this.generateEmployeeId(tx);

          const employee = await tx.employee.create({
            data: {
              ...employeeFields,
              userId: user.id,
              employeeId,
              dateOfBirth: toUtcDateOnly(employeeFields.dateOfBirth),
              dateOfJoining: toUtcDateOnly(employeeFields.dateOfJoining),
            },
          });
          return employee;
        },
        { timeout: 15000, maxWait: 10000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PrismaErrorCode.UNIQUE_CONSTRAINT) {
          throw new ConflictException(
            'A user or employee with this email or phone number already exists!',
          );
        }
        if (error.code === PrismaErrorCode.FOREIGN_KEY_CONSTRAINT) {
          throw new BadRequestException(
            'Unknown designationId or shiftId — the referenced record does not exist',
          );
        }
      }
      throw error;
    }
  }

  async findAll(query: FindEmployeeDto) {
    const {
      search,
      page,
      limit,
      designationId,
      employeeType,
      gender,
      activeOn,
      isActive,
    } = query;

    const where: Prisma.EmployeeWhereInput = {
      ...(designationId && { designationId }),
      ...(gender && { gender }),
      ...(employeeType && { employeeType }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { employeeId: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ],
      }),
      // AND, not spread — employeeEligibleOn carries its own OR
      ...(activeOn && { AND: [employeeEligibleOn(toUtcDateOnly(activeOn))] }),
    };

    const { take, skip } = getPaginationParams({ page, limit });

    const [data, total] = await this.prisma.$transaction(
      [
        this.prisma.employee.findMany({
          where,
          include: {
            designation: true,

            user: { select: { email: true, role: true, id: true } },
          },
          orderBy: { createdAt: 'desc' },
          take,
          skip,
        }),
        this.prisma.employee.count({ where }),
      ],
      { maxWait: 10000, timeout: 10000 },
    );
    return buildPaginatedResponse(data, total, page, limit);
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        bankDetails: true,
        certificates: true,
        designation: true,
        documents: true,
        educationRecords: true,
        employmentHistories: true,
        familyInfo: true,
        govtIds: true,
        exit: { include: { documents: true } },
        user: { select: { email: true, id: true, role: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const { user, ...rest } = employee;

    return {
      ...rest,
      email: user.email,
      role: user.role,
    };
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto) {
    const existing = await this.prisma.employee.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Employee not found');
    }

    try {
      const { dateOfBirth, dateOfJoining, ...rest } = updateEmployeeDto;

      return await this.prisma.employee.update({
        where: { id },
        data: {
          ...rest,
          ...(dateOfBirth && { dateOfBirth: toUtcDateOnly(dateOfBirth) }),
          ...(dateOfJoining && { dateOfJoining: toUtcDateOnly(dateOfJoining) }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PrismaErrorCode.UNIQUE_CONSTRAINT) {
          throw new ConflictException('Phone number already in use');
        }
        if (error.code === PrismaErrorCode.FOREIGN_KEY_CONSTRAINT) {
          throw new BadRequestException(
            'Unknown designationId or shiftId — the referenced record does not exist',
          );
        }
      }
      throw error;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.employee.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('Employee not found');
    }

    await this.prisma.$transaction([
      this.prisma.employee.delete({ where: { id } }),
      this.prisma.user.delete({ where: { id: existing.userId } }),
    ]);

    return { id };
  }

  private generateTempPassword(): string {
    return randomBytes(9).toString('base64url');
  }

  private async generateEmployeeId(
    tx: PrismaTransactionClient,
  ): Promise<string> {
    const PREFIX = 'WFM';

    const lastEmployee = await tx.employee.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { employeeId: true },
    });

    let nextNumber = 1;
    if (lastEmployee) {
      const lastNumber = parseInt(
        lastEmployee.employeeId.split('-').pop() ?? '0',
        10,
      );
      nextNumber = lastNumber + 1;
    }

    const paddedNumber = String(nextNumber).padStart(2, '0');
    return `${PREFIX}-EMP-${paddedNumber}`;
  }
}
