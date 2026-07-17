import { IsEnum, IsOptional } from 'class-validator';
import { DesignationCategory } from '../../generated/prisma/enums.js';

export class FindDesignationDto {
  @IsOptional()
  @IsEnum(DesignationCategory)
  category?: DesignationCategory;
}
