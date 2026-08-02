import { PartialType } from '@nestjs/mapped-types';
import { CreateAssetDto } from './create-asset.dto.js';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {}
