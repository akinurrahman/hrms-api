import { IsISO8601 } from 'class-validator';
import { PaginationQueryDto } from '../../common/index.js';

/**
 * One calendar day of the roster.
 *
 * `date` is the `attendanceDate` — the day work is attributed to. For a night
 * shift that is the day it *started*, so asking for the 5th includes the part
 * of the 5th's shift that happened on the 6th.
 *
 * No status or name filters here on purpose. The screen's job is to show every
 * eligible employee for a day so HR can see who is missing; filtering the list
 * is what hides them.
 */
export class FindRosterDto extends PaginationQueryDto {
  @IsISO8601({ strict: true })
  date!: string;
}
