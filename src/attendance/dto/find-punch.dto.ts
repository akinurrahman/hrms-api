import { IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/index.js';

/**
 * Explicit transform, not `@Type(() => Boolean)` — `Boolean('false')` is true.
 * Anything that is not 'true'/'false' passes through untouched, so undefined
 * stays undefined for `@IsOptional` and garbage stays a string and fails
 * `@IsBoolean`.
 */
const toBoolean = () =>
  Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });

export class FindPunchDto extends PaginationQueryDto {
  /** `Employee.employeeId`, the badge code — same identifier the device sends. */
  @IsOptional()
  @IsString()
  employeeCode?: string;

  /** Filters on `punchedAt`, the raw instant. Inclusive. */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  /** Filters on the resolved day, which is a different question to `from`/`to`. */
  @IsOptional()
  @IsISO8601({ strict: true })
  attendanceDate?: string;

  @IsOptional()
  @toBoolean()
  @IsBoolean()
  isProcessed?: boolean;

  @IsOptional()
  @toBoolean()
  @IsBoolean()
  isIgnored?: boolean;

  /**
   * The review queue: punches that could not be attributed to a day at all.
   * Distinct from `isIgnored`, which will also cover mid-day punches once
   * derivation lands — those resolved fine, they just lost to first-IN /
   * last-OUT.
   */
  @IsOptional()
  @toBoolean()
  @IsBoolean()
  unresolved?: boolean;
}
