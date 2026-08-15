import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** Calendar date, `YYYY-MM-DD` — the shape a `@db.Date` column stores. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePlannedAbsenceDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  /**
   * Both bounds inclusive: the 5th to the 7th is three days off, not two.
   *
   * The regex only checks shape. Whether the day exists, and whether the range
   * runs backwards, is settled in the service.
   */
  @Matches(DATE_ONLY, {
    message: 'startDate must be a calendar date in YYYY-MM-DD format',
  })
  startDate!: string;

  @Matches(DATE_ONLY, {
    message: 'endDate must be a calendar date in YYYY-MM-DD format',
  })
  endDate!: string;

  /**
   * Only meaningful on a single-day absence — the service rejects it on a range,
   * since "half of five days" describes nothing anybody can act on.
   *
   * Attendance does not act on it yet: half-day leave against a half-day worked
   * is a payroll rule, and recording the fact now is what makes that rule
   * possible later without a backfill.
   */
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
