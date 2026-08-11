import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { IsCalendarDate } from '../../common/validators/is-calendar-date.decorator.js';

export class CreateEmployeeExitDto {
  @IsEnum(ExitType)
  exitType!: ExitType;

  /** Calendar date — the column is `@db.Date` and every eligibility query keys off it. */
  @IsCalendarDate()
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

  /**
   * Only meaningful for voluntary exits — rejected for the rest.
   *
   * `null` is accepted and distinct from omission: on PATCH, omitting it keeps
   * the stored value while sending `null` clears it. `@IsOptional()` skips
   * validation for both, so `IsCalendarDate` never sees the null.
   */
  @IsOptional()
  @IsCalendarDate()
  resignationDate?: string | null;

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
