import { IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/index.js';

export class FindAnnouncementDto extends PaginationQueryDto {
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  pinned?: boolean;
}
