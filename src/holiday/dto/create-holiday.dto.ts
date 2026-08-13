import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateHolidayDto {
  /**
   * One or more festival names for this day. An array rather than a single
   * string because festivals coincide — Diwali and Govardhan Puja can land
   * together — and the alternative, a row per festival, would make "is this
   * date a holiday" return a list every caller has to reduce.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(150, { each: true })
  names!: string[];

  /**
   * Calendar date, `YYYY-MM-DD`. Stricter than `@IsDateString()` on purpose:
   * the column is `@db.Date`, so a full timestamp would let the caller believe
   * a time component was stored when it is discarded, and an offset-bearing
   * string would land on the wrong day.
   *
   * The regex only checks shape. Whether the day exists (`2026-02-30` does
   * not) is settled by `toUtcDateOnly` in the service, which turns it into a
   * 400 rather than letting a RangeError escape as a 500.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a calendar date in YYYY-MM-DD format',
  })
  date!: string;

  /** Restricted / floating holiday — attendance treats it as a working day. */
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}
