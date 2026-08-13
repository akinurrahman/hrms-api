import { HolidayCompensation } from './attendance-enums.js';

/**
 * Every tunable the attendance module has.
 *
 * Nothing in `src/attendance/` may restate one of these values inline. They
 * are read through `AttendancePolicyService.get(siteId?)`, which today returns
 * the defaults below and, once multi-tenancy lands, reads a per-tenant row
 * instead. Consumers do not change when that happens — that is the point.
 */
export interface AttendancePolicy {
  /** Worked percentage at or above which the day is a full day. */
  halfDayThresholdPercent: number;

  /**
   * Worked percentage at or above which the day is a half day. Below it, the
   * day is absent despite the punches.
   */
  absentThresholdPercent: number;

  /**
   * Offset of the business's wall clock from UTC, in minutes. Shift times are
   * minutes-from-midnight on this clock; punches are UTC instants.
   *
   * 330 = IST. India observes no daylight saving, so a fixed offset is exact
   * rather than an approximation. A zone with DST would need a zone name and
   * a real timezone library instead of a number.
   */
  businessUtcOffsetMinutes: number;

  /**
   * Skip the break deduction on days too short to have contained a break.
   *
   * Deducting unconditionally charges an hour of lunch to somebody who left
   * before lunch: 09:00-13:00 becomes 180 worked minutes instead of 240,
   * which drops a genuine half day into absent. Set false for the strict
   * always-deduct behaviour.
   */
  deductBreakOnlyIfDayLongEnough: boolean;

  /**
   * Default route for compensating holiday and weekly-off work. HR overrides
   * per row. PRD §12 open question 10 — becomes site config with
   * multi-tenancy.
   */
  defaultCompensationType: HolidayCompensation;

  /**
   * How early before shift start a punch is still attributed to that shift's
   * day, and how late after shift end.
   *
   * Deliberately wider than `shift.graceMinutes`, and deliberately not the
   * same setting: grace decides whether somebody is *late*, this decides which
   * *day* their punch is about. A ten-minute grace used as an ingestion
   * bracket would orphan everyone who punched out a quarter of an hour after
   * their shift ended.
   *
   * The two brackets are asymmetric because the behaviour is: people trickle
   * in shortly before start, and trail out well after end.
   */
  punchWindowBeforeMinutes: number;
  punchWindowAfterMinutes: number;
}

/**
 * The single place in the codebase where an attendance number is written down.
 *
 * Thresholds are 75/50 against net shift minutes: on a 480-minute shift a full
 * day needs 6 hours and a half day needs 4. The half-day floor sitting at
 * exactly half the shift is what makes it defensible to an employee reading a
 * payslip.
 *
 * Lateness is not here — `graceMinutes` lives on `Shift`, because grace varies
 * by shift timing (an 06:00 shift needs more slack than a 10:00 one).
 *
 * Known accepted risk (PRD §5.3): these are not versioned by date. Changing
 * them changes the result of recomputing any unlocked past day. Locked periods
 * are protected by their snapshot, so the blast radius is the open period.
 */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  halfDayThresholdPercent: 75,
  absentThresholdPercent: 50,
  businessUtcOffsetMinutes: 330,
  deductBreakOnlyIfDayLongEnough: true,
  defaultCompensationType: HolidayCompensation.PAID_EXTRA,
  punchWindowBeforeMinutes: 120,
  punchWindowAfterMinutes: 180,
};
