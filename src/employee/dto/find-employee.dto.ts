import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { EmployeeType, Gender } from '../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.decorator.js';

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

  /** Who was on rolls on this date — joined by then, not yet past their last working day. */
  @IsOptional()
  @IsCalendarDate()
  activeOn?: string;

  @IsOptional()
  @Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
