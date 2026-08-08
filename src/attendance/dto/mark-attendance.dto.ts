import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class MarkAttendanceDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId!: string;

  // Plain date, e.g. "2026-08-06" — no time component.
  // Matches the @db.Date column on Attendance.
  @IsDateString()
  @IsNotEmpty()
  date!: string;

  // Optional on purpose: admin marking someone ABSENT sends neither.
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
