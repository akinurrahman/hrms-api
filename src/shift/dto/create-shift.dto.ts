import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MINUTES_IN_DAY } from '../utils/shift-time.js';

/** Last addressable minute of the day. Midnight-end is stored as 0. */
const LAST_MINUTE_OF_DAY = MINUTES_IN_DAY - 1;

export class CreateShiftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @IsInt()
  @Min(0)
  @Max(LAST_MINUTE_OF_DAY)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(LAST_MINUTE_OF_DAY)
  endMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  graceMinutes?: number;

  /** 0 = Sunday ... 6 = Saturday */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyOffDays?: number[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
