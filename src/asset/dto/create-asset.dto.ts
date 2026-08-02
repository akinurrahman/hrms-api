import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { AssetCategory, AssetStatus } from '../../generated/prisma/enums.js';

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  assetTag!: string;

  @IsEnum(AssetCategory)
  category!: AssetCategory;

  @IsEnum(AssetStatus)
  @IsOptional()
  status?: AssetStatus;

  @IsUUID()
  @IsOptional()
  assignedToEmployeeId?: string;
}
