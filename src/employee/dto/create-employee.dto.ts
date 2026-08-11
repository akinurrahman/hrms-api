import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { EmployeeType, Gender } from '../../generated/prisma/client.js';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.decorator.js';

export class CreateEmployeeDto {
  // -- user field --
  @IsEmail()
  email!: string;

  // -- employee fields --
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  alternateNumber!: string;

  @IsCalendarDate()
  dateOfBirth!: string;

  @IsEnum(Gender)
  gender!: Gender;

  @IsEnum(EmployeeType)
  employeeType!: EmployeeType;

  @IsString()
  @IsNotEmpty()
  designationId!: string;

  /** Feeds `employeeEligibleOn()`, so a day of drift here shifts every roster and summary. */
  @IsCalendarDate()
  dateOfJoining!: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  // -- communication address --
  @IsString()
  @IsNotEmpty()
  commAddressLine!: string;

  @IsString()
  @IsNotEmpty()
  commCity!: string;

  @IsString()
  @IsNotEmpty()
  commState!: string;

  @IsString()
  @IsNotEmpty()
  commPin!: string;

  @IsString()
  @IsNotEmpty()
  commCountry!: string;

  //   -- permanent address --
  @IsString()
  @IsNotEmpty()
  permAddressLine!: string;

  @IsString()
  @IsNotEmpty()
  permCity!: string;

  @IsString()
  @IsNotEmpty()
  permState!: string;

  @IsString()
  @IsNotEmpty()
  permPin!: string;

  @IsString()
  @IsNotEmpty()
  permCountry!: string;
}
