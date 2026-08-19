import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/index.js';

/**
 * One payroll cycle of the monthly sheet.
 *
 * `year`/`month` is the *label*, matching the way `AttendancePeriod` names
 * itself — not a date range and not a filter on `attendanceDate`. A 26-to-25
 * cycle labelled August starts in July, and asking for August has to return that
 * cycle rather than the calendar month.
 *
 * Paginated on employees, not on days: the grid is employees down and days
 * across, so a page is a set of rows and every row carries its whole month.
 */
export class FindMonthlyDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2999)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}
