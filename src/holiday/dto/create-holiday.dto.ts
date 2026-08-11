import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.decorator.js';

export class CreateHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  /**
   * Calendar date, `YYYY-MM-DD`. Stricter than `@IsDateString()` on purpose —
   * see the note on `IsCalendarDate`. A bare regex is not enough: it lets
   * `2026-02-30` through to `toUtcDateOnly()`, which throws a `RangeError` the
   * exception filter does not catch.
   */
  @IsCalendarDate()
  date!: string;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}
