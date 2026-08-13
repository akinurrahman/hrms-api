import { ShiftTimes, shiftSpanMinutes } from '../../shift/utils/shift-time.js';
import {
  businessInstant,
  MS_PER_MINUTE,
} from '../../common/utils/business-time.js';
import { toUtcDateOnly } from '../../common/utils/date.js';
import { AttendancePolicy } from '../constants/attendance-policy.constant.js';
import { PunchIgnoreReason } from '../constants/punch-ignore-reason.constant.js';

/**
 * Which day does this punch belong to?
 *
 * Pure, like `aggregate()`: no database, no Nest, no side effects, and nothing
 * read from the host clock or the host timezone.
 *
 * The question is not rhetorical. A punch is a UTC instant; a shift is minutes
 * from midnight on the office wall clock. For a day shift the answer is the
 * local calendar date and the whole thing looks trivial. For a 22:00-06:00
 * shift it is not: a punch at 02:00 on Jan 6 belongs to **Jan 5**, the day the
 * shift started, and a midnight-to-midnight bucket would file it under Jan 6.
 *
 * Getting that wrong does not fail loudly. It moves night-shift work across a
 * month boundary, and the month locks with the wrong total.
 *
 * The method is a window search rather than arithmetic on the date: build each
 * candidate day's shift window as real instants and ask which one contains the
 * punch. That handles day shifts, night shifts and shifts starting just after
 * midnight with the same three lines, and it stays correct when the brackets
 * are retuned.
 */

/** Only the fields the search needs — not the whole Prisma model. */
export type ResolvePunchShift = ShiftTimes;

export type ResolvePunchPolicy = Pick<
  AttendancePolicy,
  | 'businessUtcOffsetMinutes'
  | 'punchWindowBeforeMinutes'
  | 'punchWindowAfterMinutes'
>;

export interface ResolvePunchDateInput {
  /** Full UTC instant as reported by the device. */
  punchedAt: Date;
  /**
   * Required. A missing shift is the caller's hard guard (PRD §9 case 13) and
   * is reported as `NO_SHIFT_ASSIGNED` there, not defaulted here.
   */
  shift: ResolvePunchShift;
  policy: ResolvePunchPolicy;
}

export type ResolvePunchDateResult =
  /** UTC-midnight `Date`, ready for a `@db.Date` column. */
  | { attendanceDate: Date }
  | { attendanceDate: null; reason: PunchIgnoreReason };

/**
 * Candidate offsets in days from the punch's own local date.
 *
 * `-1` is what catches the night-shift punch after midnight. `+1` catches its
 * mirror image: a shift starting shortly after midnight, punched into late on
 * the previous evening. `0` is every ordinary day.
 */
const CANDIDATE_DAY_OFFSETS = [-1, 0, 1] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Candidate {
  attendanceDate: Date;
  shiftStart: Date;
  windowStart: Date;
  windowEnd: Date;
}

export function resolvePunchDate(
  input: ResolvePunchDateInput,
): ResolvePunchDateResult {
  const { punchedAt, shift, policy } = input;

  const matches = CANDIDATE_DAY_OFFSETS.map((offset) =>
    buildCandidate(punchedAt, offset, shift, policy),
  ).filter(
    (candidate) =>
      punchedAt >= candidate.windowStart && punchedAt <= candidate.windowEnd,
  );

  if (matches.length === 0) {
    return {
      attendanceDate: null,
      reason: PunchIgnoreReason.OUTSIDE_SHIFT_WINDOW,
    };
  }

  return { attendanceDate: pick(matches, punchedAt).attendanceDate };
}

/**
 * A long span plus a wide bracket can leave two days' windows overlapping. The
 * rule is "the most recent shift that has actually begun" — which is what a
 * human would say looking at the same two options.
 *
 * It has to be a rule rather than "take the first match", because ingestion is
 * re-runnable by design: a resolver that answered differently on a replay would
 * quietly move a day's work, and the unique constraint would not catch it.
 */
function pick(matches: Candidate[], punchedAt: Date): Candidate {
  const started = matches.filter(
    (candidate) => candidate.shiftStart <= punchedAt,
  );

  if (started.length > 0) {
    return started.reduce((latest, candidate) =>
      candidate.shiftStart > latest.shiftStart ? candidate : latest,
    );
  }

  // Every match is still ahead of the punch — an early arrival sitting inside
  // two before-brackets. The nearer shift is the one they turned up for.
  return matches.reduce((earliest, candidate) =>
    candidate.shiftStart < earliest.shiftStart ? candidate : earliest,
  );
}

function buildCandidate(
  punchedAt: Date,
  dayOffset: number,
  shift: ResolvePunchShift,
  policy: ResolvePunchPolicy,
): Candidate {
  const attendanceDate = shiftDays(
    localDateOf(punchedAt, policy.businessUtcOffsetMinutes),
    dayOffset,
  );

  // Both boundaries as real instants. `shiftSpanMinutes` already adds a day
  // for a night shift, so the end rolls into tomorrow without a special case.
  const shiftStart = businessInstant(
    attendanceDate,
    shift.startMinutes,
    policy.businessUtcOffsetMinutes,
  );
  const shiftEnd = new Date(
    shiftStart.getTime() + shiftSpanMinutes(shift) * MS_PER_MINUTE,
  );

  return {
    attendanceDate,
    shiftStart,
    // Inclusive on both ends: a punch landing exactly on the bracket is inside
    // it. There is no reason to send someone to manual review for being
    // punctual to the minute.
    windowStart: new Date(
      shiftStart.getTime() - policy.punchWindowBeforeMinutes * MS_PER_MINUTE,
    ),
    windowEnd: new Date(
      shiftEnd.getTime() + policy.punchWindowAfterMinutes * MS_PER_MINUTE,
    ),
  };
}

/** The business-local calendar date an instant fell on, as UTC midnight. */
function localDateOf(instant: Date, utcOffsetMinutes: number): Date {
  return toUtcDateOnly(
    new Date(instant.getTime() + utcOffsetMinutes * MS_PER_MINUTE),
  );
}

/**
 * Day arithmetic on a UTC-midnight date. Safe across month, year and leap-day
 * boundaries because UTC has no DST — the same shift in a zone that observes it
 * would need a real timezone library, as `businessInstant` already notes.
 */
function shiftDays(dateOnly: Date, days: number): Date {
  return new Date(dateOnly.getTime() + days * MS_PER_DAY);
}
