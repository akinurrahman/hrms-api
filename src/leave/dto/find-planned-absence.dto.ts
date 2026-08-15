import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/index.js';
import { PlannedAbsenceStatus } from '../../generated/prisma/enums.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class FindPlannedAbsenceDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /**
   * `from`/`to` filter by overlap, not by containment: an absence running the
   * 28th to the 3rd shows up when you ask for either month. Filtering by
   * containment would hide exactly the records that span a boundary, which are
   * the ones somebody looking at a month boundary is looking for.
   */
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'from must be a calendar date in YYYY-MM-DD format',
  })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'to must be a calendar date in YYYY-MM-DD format',
  })
  to?: string;

  @IsOptional()
  @IsEnum(PlannedAbsenceStatus)
  status?: PlannedAbsenceStatus;
}
