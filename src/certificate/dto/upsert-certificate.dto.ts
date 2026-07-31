import { Type } from 'class-transformer';
import { IsArray, IsUUID, ValidateNested } from 'class-validator';
import { CertificateItemDto } from './certificate-item.dto.js';

export class UpsertCertificateDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificateItemDto)
  upsert!: CertificateItemDto[];

  @IsArray()
  @IsUUID('4', { each: true })
  deleteIds!: string[];
}
