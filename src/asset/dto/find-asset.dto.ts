import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AssetCategory, AssetStatus } from '../../generated/prisma/enums.js';
import { PaginationQueryDto } from '../../common/index.js';

export class FindAssetDto extends PaginationQueryDto {
  @IsEnum(AssetCategory)
  @IsOptional()
  category?: AssetCategory;

  @IsEnum(AssetStatus)
  @IsOptional()
  status?: AssetStatus;

  @IsUUID()
  @IsOptional()
  assignedToEmployeeId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
