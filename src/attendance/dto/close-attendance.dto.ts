import { IsISO8601 } from 'class-validator';

/**
 * The day to close.
 *
 * Deliberately one date and no range. Closing is the act that turns silence into
 * ABSENT rows across the whole headcount, and a range makes it far too easy to
 * do that to a month by typo. Backfilling several days is a loop over several
 * calls, each of which reports what it did.
 *
 * `date` is the `attendanceDate` — the day work is attributed to. For a night
 * shift that is the day it *started*.
 */
export class CloseAttendanceDto {
  @IsISO8601({ strict: true })
  date!: string;
}
