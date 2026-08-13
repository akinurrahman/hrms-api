/**
 * Why a stored punch does not contribute to a derived day.
 *
 * A plain string column rather than a database enum (PRD §5.7 `ignoreReason
 * String?`), because the set grows as derivation grows and a migration per new
 * reason buys nothing — nothing queries these by equality except a review
 * screen. Shape follows `attendance-enums.ts`: `as const` object plus derived
 * union, so the values are usable as a type without a second declaration.
 *
 * The punch is always stored. "Ignored" means excluded from the arithmetic,
 * never discarded — the raw layer is append-only and every one of these is a
 * row HR can look at.
 */
export const PunchIgnoreReason = {
  /**
   * The employee has no shift. Attributing the punch would mean inventing a
   * shift to attribute it against, and a default 9-to-6 produces
   * plausible-looking wrong numbers, which is worse than refusing (PRD §9
   * case 13).
   */
  NO_SHIFT_ASSIGNED: 'NO_SHIFT_ASSIGNED',

  /**
   * No candidate day's punch window contains the instant — a day-shift
   * employee's badge at 03:00, or a device replaying a timestamp from a
   * period the employee was not rostered for.
   */
  OUTSIDE_SHIFT_WINDOW: 'OUTSIDE_SHIFT_WINDOW',

  /**
   * Resolved cleanly to a day the employee was not on rolls for — a leaver's
   * badge still being used, or a punch dated before they joined.
   */
  NOT_ON_ROLLS: 'NOT_ON_ROLLS',

  // MID_DAY_PUNCH joins this list with derivation, when the first-IN /
  // last-OUT rule starts discarding the punches in between.
} as const;

export type PunchIgnoreReason =
  (typeof PunchIgnoreReason)[keyof typeof PunchIgnoreReason];
