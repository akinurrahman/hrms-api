/**
 * Attendance enums.
 *
 * These were hand-declared in Phase 3 so `aggregate()` had a return type before
 * the `Attendance` model existed. The model landed in Phase 5, so the values now
 * come from Prisma and this file is a re-export — one definition, and the DB can
 * no longer disagree with the code.
 *
 * The indirection stays on purpose: every attendance import already points here,
 * and it is the natural place to hang the notes below.
 *
 * - `DayType` is a property of the calendar and the employee's roster.
 *   `AttendanceStatus` is what the employee actually did. They are separate
 *   because the two diverge the moment somebody works on a holiday.
 * - `aggregate()` only ever returns PRESENT, HALF_DAY, ABSENT and
 *   MISSING_CHECKOUT. ON_LEAVE and NOT_APPLICABLE are decided upstream, before
 *   any punch arithmetic happens.
 * - `AttendanceSource` precedence is SYSTEM < DEVICE < MANUAL. The ranking is
 *   implemented once, in `utils/attendance-source.ts`.
 */

export {
  DayType,
  AttendanceStatus,
  AttendanceSource,
  HolidayCompensation,
} from '../../generated/prisma/enums.js';
