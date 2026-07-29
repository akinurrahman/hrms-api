import { IsArray, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EmploymentHistoryItemDto } from './employment-history-item.dto.js';

export class UpsertEmploymentHistoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmploymentHistoryItemDto)
  upsert!: EmploymentHistoryItemDto[];

  @IsArray()
  @IsUUID('4', { each: true })
  deleteIds!: string[];
}
