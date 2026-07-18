import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EmployeeType, Gender } from '../../generated/prisma/client.js';

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

  @IsDateString()
  dateOfBirth!: string;

  @IsEnum(Gender)
  gender!: Gender;

  @IsEnum(EmployeeType)
  employeeType!: EmployeeType;

  @IsString()
  @IsNotEmpty()
  designationId!: string;

  @IsDateString()
  dateOfJoining!: string;

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
