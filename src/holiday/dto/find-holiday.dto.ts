import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * No pagination here, unlike the other list endpoints. A year of holidays is a
 * bounded set — well under thirty rows — and both the roster and the close job
 * want the whole year in one call to build a lookup map.
 */
export class FindHolidayDto {
  /** Defaults to the current year in the service, not here, so the default follows the server clock. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(2999)
  year?: number;

  // Explicit transform, not @Type(() => Boolean) — Boolean('false') is true.
  @IsOptional()
  @Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isOptional?: boolean;
}
