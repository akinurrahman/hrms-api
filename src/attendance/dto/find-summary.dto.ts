import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/index.js';

/**
 * A locked cycle's generated summaries.
 *
 * Defaults to the current version, because that is what payroll reads and
 * anything else would be a footgun. `version` is for the other reader — a
 * dispute, asking what the numbers said before the month was reopened and
 * regenerated.
 */
export class FindSummaryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
