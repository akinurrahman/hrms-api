import { ConflictException, Injectable } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';
import { UserService } from '../user/user.service.js';
import { randomBytes } from 'crypto';

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
              dateOfBirth: new Date(employeeFields.dateOfBirth),
              dateOfJoining: new Date(employeeFields.dateOfJoining),
            },
          });
          return employee;
        },
        { timeout: 15000, maxWait: 10000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
      ) {
        throw new ConflictException(
          'A user or employee with this email or phone number already exists!',
        );
      }
      throw error
    }
  }

  // Not built yet, left as stubs so the controller still compiles.
  // We'll replace these one at a time after create() is tested.
  findAll() {
    return `This action returns all employee`;
  }

  findOne(id: string) {
    return `This action returns a #${id} employee`;
  }

  update(id: string, updateEmployeeDto: UpdateEmployeeDto) {
    return `This action updates a #${id} employee`;
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
