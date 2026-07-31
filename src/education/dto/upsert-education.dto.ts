import { Type } from 'class-transformer';
import { IsArray, IsUUID, ValidateNested } from 'class-validator';
import { EducationItemDto } from './education-item.dto.js';

export class UpsertEducationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationItemDto)
  upsert!: EducationItemDto[];

  @IsArray()
  @IsUUID('4', { each: true })
  deleteIds!: string[];
}
