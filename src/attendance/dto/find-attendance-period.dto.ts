import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/index.js';
import { PeriodStatus } from '../constants/attendance-enums.js';

/**
 * Paginated, unlike `FindHolidayDto`'s whole-year shape. A year holds a handful
 * of holidays and the client draws a calendar from all of them at once; periods
 * accumulate twelve a year forever, and the screen that reads them wants recent
 * cycles first.
 */
export class FindAttendancePeriodDto extends PaginationQueryDto {
  /** Narrows to one label year — the leading column of `@@unique([year, month])`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2999)
  year?: number;

  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;
}
