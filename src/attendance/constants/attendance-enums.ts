/**
 * Attendance enums, hand-declared ahead of the schema.
 *
 * The `Attendance` model lands in Phase 5; these values are needed in Phase 3
 * for `aggregate()`'s return type. The shape here is byte-for-byte what Prisma
 * generates (`as const` object + derived union type), so when the model exists
 * this file's body collapses to a re-export and not one call site changes:
 *
 *   export {
 *     DayType, AttendanceStatus, AttendanceSource, HolidayCompensation,
 *   } from '../../generated/prisma/enums.js';
 *
 * Values must stay identical to PRD §5.8.
 */

/** A property of the calendar and the employee's roster, not of what they did. */
export const DayType = {
  WORKING: 'WORKING',
  WEEKLY_OFF: 'WEEKLY_OFF',
  HOLIDAY: 'HOLIDAY',
} as const;

export type DayType = (typeof DayType)[keyof typeof DayType];

/**
 * What the employee actually did. Kept separate from `DayType` because the
 * two diverge the moment somebody works on a holiday.
 *
 * `aggregate()` only ever returns PRESENT, HALF_DAY, ABSENT and
 * MISSING_CHECKOUT. ON_LEAVE and NOT_APPLICABLE are decided upstream by the
 * close job, which resolves holidays, weekly offs and leave before any
 * punch arithmetic happens.
 */
export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  ON_LEAVE: 'ON_LEAVE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  MISSING_CHECKOUT: 'MISSING_CHECKOUT',
} as const;

export type AttendanceStatus =
  (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

/** Precedence: SYSTEM < DEVICE < MANUAL. A write never loses to a lower rank. */
export const AttendanceSource = {
  SYSTEM: 'SYSTEM',
  DEVICE: 'DEVICE',
  MANUAL: 'MANUAL',
} as const;

export type AttendanceSource =
  (typeof AttendanceSource)[keyof typeof AttendanceSource];

/**
 * How holiday or weekly-off work gets compensated. Attendance records which
 * route was taken; payroll decides the rate. Cash and comp-off are mutually
 * exclusive and nothing downstream can tell them apart afterwards.
 */
export const HolidayCompensation = {
  PAID_EXTRA: 'PAID_EXTRA',
  COMP_OFF: 'COMP_OFF',
} as const;

export type HolidayCompensation =
  (typeof HolidayCompensation)[keyof typeof HolidayCompensation];
