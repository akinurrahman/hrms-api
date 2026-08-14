import { IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/** Explicit transform, not `@Type(() => Boolean)` — `Boolean('false')` is true. */
const toBoolean = () =>
  Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });

/**
 * Recompute the days covered by stored punches in a range.
 *
 * The range is over `attendanceDate` — the day the work belongs to — not over
 * `punchedAt`. For a night shift those differ, and asking "redo the 5th" has to
 * mean the 5th's shift, including the part of it that happened on the 6th.
 */
export class DeriveAttendanceDto {
  @IsISO8601({ strict: true })
  from!: string;

  @IsISO8601({ strict: true })
  to!: string;

  /** `Employee.employeeId`, the badge code. Omit to cover everyone. */
  @IsOptional()
  @IsString()
  employeeCode?: string;

  /**
   * Re-derive days already processed.
   *
   * The default only picks up punches nothing has looked at yet, which is the
   * routine catch-up case. `force` is for when the *answer* changed rather than
   * the input: a corrected `aggregate()`, or a holiday declared after the fact
   * (PRD §9 case 15). The punches are still there, so it is always safe.
   */
  @IsOptional()
  @toBoolean()
  @IsBoolean()
  force?: boolean;
}
