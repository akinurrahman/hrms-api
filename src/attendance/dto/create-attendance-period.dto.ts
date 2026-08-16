import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * Calendar date, `YYYY-MM-DD` — the shape a `@db.Date` column stores.
 *
 * `@Matches` rather than the `@IsISO8601({ strict: true })` the rest of this
 * module's DTOs use: strict ISO-8601 also accepts an offset-bearing timestamp
 * like `2026-08-01T09:00:00+05:30`, and a period boundary is a calendar day, not
 * an instant. Accepting one would silently move the bound for every client east
 * of UTC.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAttendancePeriodDto {
  /**
   * The label, and it is only a label. A 26-to-25 cycle ending 25 Aug is
   * "August 2026" regardless of where its `startDate` falls.
   */
  @IsInt()
  @Min(2000)
  @Max(2999)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  /**
   * Omit both and the period defaults to the calendar month.
   *
   * Supply both or neither — the service refuses one on its own. Defaulting the
   * missing half is how a 26-to-25 cycle ends up running 26 Aug to 31 Aug, which
   * is a period nobody asked for and which nothing downstream would flag.
   *
   * The regex only checks shape. Whether the day exists, whether the range runs
   * backwards, and whether it overlaps an existing period is settled in the
   * service.
   */
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'startDate must be a calendar date in YYYY-MM-DD format',
  })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'endDate must be a calendar date in YYYY-MM-DD format',
  })
  endDate?: string;

  // No `status`. A period is always born OPEN: locking is an action with an
  // actor and a time attached to it, and accepting the status here would allow a
  // LOCKED row with no `lockedById` and no `lockedAt` to explain itself.
}
