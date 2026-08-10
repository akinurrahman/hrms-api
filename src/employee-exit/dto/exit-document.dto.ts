import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ExitDocumentType } from '../../generated/prisma/enums.js';

export class ExitDocumentDto {
  @IsEnum(ExitDocumentType)
  type!: ExitDocumentType;

  /** Required only when type is OTHER — otherwise the enum already names it. */
  @ValidateIf((o: ExitDocumentDto) => o.type === ExitDocumentType.OTHER)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  customName?: string;

  /**
   * Opaque storage key (Cloudinary public_id / S3 key). Intentionally not
   * URL-validated — the upload pipeline does not exist yet, so callers may
   * send either a key or a full URL.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  fileKey!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName?: string;
}
