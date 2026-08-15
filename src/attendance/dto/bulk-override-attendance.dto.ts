import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OverrideAttendanceDto } from './override-attendance.dto.js';

export class BulkOverrideEntryDto extends OverrideAttendanceDto {
  /**
   * `Employee.id`, the UUID — not the badge code. This body is built from the
   * roster response, which already carries it.
   */
  @IsString()
  @IsNotEmpty()
  employeeId!: string;
}

/**
 * The roster screen's save.
 *
 * One date for the whole batch, because that is what the screen shows. Entries
 * are explicit ids rather than a filter: "mark everyone matching this query" is
 * a more powerful design and a much easier way to mark four hundred people
 * present by accident.
 *
 * All-or-nothing. Partial success on a payroll input leaves HR unsure what
 * saved, which is worse than saving nothing.
 */
export class BulkOverrideAttendanceDto {
  /** `YYYY-MM-DD`. The business-local date the roster was showing. */
  @IsISO8601({ strict: true })
  date!: string;

  /**
   * `@ValidateNested({ each: true })` and `@Type()` are both required — with
   * only one of them the items reach the service unvalidated.
   *
   * Capped at 200: past that the transaction starts competing with its own
   * 15-second timeout, and a page of roster is far smaller anyway.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkOverrideEntryDto)
  entries!: BulkOverrideEntryDto[];
}
