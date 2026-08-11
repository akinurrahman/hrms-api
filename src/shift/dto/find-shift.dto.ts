import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/index.js';

export class FindShiftDto extends PaginationQueryDto {
  // Explicit transform, not @Type(() => Boolean) — Boolean('false') is true.
  // The transform also runs when the key is absent, so anything that is not
  // 'true'/'false' is passed through untouched: undefined stays undefined (and
  // @IsOptional skips it), garbage stays a string and fails @IsBoolean.
  @IsOptional()
  @Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
