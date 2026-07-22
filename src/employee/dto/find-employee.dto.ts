import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EmployeeType, Gender } from '../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class FindEmployeeDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsEnum(EmployeeType)
  employeeType?: EmployeeType;

  @IsOptional()
  @IsString()
  search?: string; // matches against fullName, employeeId, email

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}
