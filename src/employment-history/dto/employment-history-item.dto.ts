import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsUUID,
  IsDateString,
  IsNumber,
} from 'class-validator';
import { SalaryPeriod } from '../../generated/prisma/enums.js';

export class EmploymentHistoryItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  orgName!: string;

  @IsString()
  @IsNotEmpty()
  designation!: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isCurrentlyWorking?: boolean;

  @IsOptional()
  @IsString()
  jobResponsibilities?: string;

  @IsOptional()
  @IsNumber()
  salary?: number;

  @IsOptional()
  @IsEnum(SalaryPeriod)
  salaryPeriod?: SalaryPeriod;
}
