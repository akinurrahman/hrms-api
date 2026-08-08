import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MarkAttendanceDto } from './dto/mark-attendance.dto.js';
import { aggregate } from './utils/aggregate.js';
import { Prisma, type Shift } from '../generated/prisma/client.js';
import { PrismaErrorCode } from '../common/index.js';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async markAttendance(dto: MarkAttendanceDto, markedById: string) {
    let shift: Shift | null = null;
    if (dto.shiftId) {
      try {
        shift = await this.prisma.shift.findUniqueOrThrow({
          where: { id: dto.shiftId },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === PrismaErrorCode.NOT_FOUND
        ) {
          throw new NotFoundException(`Shift with id ${dto.shiftId} not found`);
        }
        throw err;
      }
    }

    const policy = await this.prisma.attendancePolicy.findFirst();

    const checkIn = dto.checkIn ? new Date(dto.checkIn) : null;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : null;

    // Run the pure calculation. Percent -> ratio conversion happens
    //    here at the boundary, aggregate() itself only knows ratios.
    const result = aggregate({
      checkIn,
      checkOut,
      shift,
      ...(policy && {
        absentThreshold: policy.absentThresholdPercent / 100,
        halfDayThreshold: policy.halfDayThresholdPercent / 100,
      }),
    });

    // One row per employee per day -> upsert on the unique constraint.
    //    Marking someone twice for the same day overwrites, not duplicates.
    return this.prisma.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId: dto.employeeId,
          date: new Date(dto.date),
        },
      },
      create: {
        employeeId: dto.employeeId,
        date: new Date(dto.date),
        checkIn,
        checkOut,
        shiftId: dto.shiftId ?? null,
        remarks: dto.remarks,
        source: 'ADMIN_MANUAL',
        markedById,
        ...result,
      },
      update: {
        checkIn,
        checkOut,
        shiftId: dto.shiftId ?? null,
        remarks: dto.remarks,
        markedById,
        ...result,
      },
    });
  }
}
