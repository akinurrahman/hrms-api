import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ExitType } from '../../generated/prisma/enums.js';
import { ExitDocumentDto } from './exit-document.dto.js';

export class CreateEmployeeExitDto {
  @IsEnum(ExitType)
  exitType!: ExitType;

  @IsDateString()
  lastWorkingDay!: string;

  /** Required when the exit type is OTHER, since the enum says nothing then. */
  @ValidateIf((o: CreateEmployeeExitDto) => o.exitType === ExitType.OTHER)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  notes?: string;

  /** Only meaningful for voluntary exits — rejected for the rest. */
  @IsOptional()
  @IsDateString()
  resignationDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  noticePeriodDays?: number;

  @IsOptional()
  @IsBoolean()
  isRehireEligible?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rehireRemark?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExitDocumentDto)
  documents?: ExitDocumentDto[];
}
