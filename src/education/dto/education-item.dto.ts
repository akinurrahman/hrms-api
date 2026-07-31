import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class EducationItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  instituteName!: string;

  @IsString()
  @IsNotEmpty()
  courseName!: string;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsBoolean()
  @IsNotEmpty()
  isCurrentlyStudying!: boolean;

  @IsInt()
  @IsOptional()
  passingYear?: number;

  @IsString()
  @IsOptional()
  divisionGrade?: string;

  @IsString()
  @IsOptional()
  marksObtained?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}
