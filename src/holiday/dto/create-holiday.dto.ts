import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  /**
   * Calendar date, `YYYY-MM-DD`. Deliberately stricter than `@IsDateString()`:
   * the column is `@db.Date`, so accepting a full timestamp would let the
   * caller believe a time component was stored when it is thrown away, and
   * would make an offset-bearing string land on the wrong day.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a calendar date in YYYY-MM-DD format',
  })
  date!: string;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}
