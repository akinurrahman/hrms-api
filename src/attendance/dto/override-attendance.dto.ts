import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  AttendanceStatus,
  HolidayCompensation,
} from '../constants/attendance-enums.js';

/** 24-hour wall clock, zero-padded. `9:5` and `24:00` are both rejected. */
export const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * HR's answer for one employee-day.
 *
 * Two modes, and the service rejects anything that is both or neither:
 *
 * - **Time mode** — `checkIn` and/or `checkOut`. The arithmetic runs and decides
 *   the status.
 * - **Status mode** — an explicit `status`. The arithmetic is skipped and the
 *   times stay null.
 */
export class OverrideAttendanceDto {
  /**
   * Status mode. Only `ABSENT` is accepted today: `ON_LEAVE` needs a backing
   * leave record to point at, and `NOT_APPLICABLE` is the close job's call once
   * it exists. The service returns the specific reason.
   */
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  /**
   * Time mode. Wall-clock time on the *office* clock, e.g. `09:15`.
   *
   * Deliberately not an instant: HR reads 09:15 off a form and should type
   * 09:15. Converting it against the business offset is the server's job, in
   * one place, rather than every client's.
   */
  @IsOptional()
  @Matches(HH_MM, { message: 'checkIn must be a HH:mm time, e.g. 09:15' })
  checkIn?: string;

  /**
   * As `checkIn`. A value earlier on the clock than the check-in is read as the
   * next morning, which is what a night shift needs.
   */
  @IsOptional()
  @Matches(HH_MM, { message: 'checkOut must be a HH:mm time, e.g. 18:30' })
  checkOut?: string;

  /**
   * Required, because this write sets `source = MANUAL`.
   *
   * Enforced here rather than in the database: SYSTEM and DEVICE rows
   * legitimately have no remark, so the column stays nullable and the rule
   * lives on the only path that breaks it.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  remark!: string;

  /**
   * The route for compensating a worked holiday or weekly off. Omitted, the
   * policy default applies; on a day that earned no compensation it is ignored
   * rather than honoured.
   */
  @IsOptional()
  @IsEnum(HolidayCompensation)
  compensationType?: HolidayCompensation;
}
