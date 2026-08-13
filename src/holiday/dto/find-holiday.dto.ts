import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class FindHolidayDto {
  /**
   * Defaults to the current year, applied in the service rather than here so
   * the default follows the server clock at request time.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(2999)
  year?: number;

  @IsOptional()
  @Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isOptional?: boolean;
}
