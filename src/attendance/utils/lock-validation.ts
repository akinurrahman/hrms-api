import { AttendanceStatus } from '../constants/attendance-enums.js';
import { eachDateInRange, toDateKey } from '../../common/utils/date.js';
import {
  DateWindow,
  DayBucket,
  SummaryRow,
  bucketDay,
  isWithinWindow,
} from './monthly-summary.js';

/**
 * What has to be true before a month may be locked. Pure: no database, no Nest,
 * no host clock.
 *
 * This is the step that makes the lock mean anything. Generating summaries from
 * a month that still contains unfinished records does not produce uncertain
 * numbers — it produces confident ones, computed from rows nobody has looked at,
 * which payroll then pays against. Refusing with a list is the whole feature;
 * the summary generation next door is the easy part.
 *
 * Everything here is refused rather than repaired. Each blocker is a question
 * only a human can answer — did this person work the day they never checked out
 * of, is the punch or the manual mark the true one — and answering them
 * automatically at 3am is how a wrong month becomes an unnoticed one.
 */

/** Why a month cannot be locked. Each is a separate entry, per employee. */
export const LockBlockerReason = {
  /** Checked in, never checked out. The record is incomplete, not disputed. */
  MISSING_CHECKOUT: 'MISSING_CHECKOUT',
  /** A lower-ranked write had something to say and was not allowed to say it. */
  UNRESOLVED_CONFLICT: 'UNRESOLVED_CONFLICT',
  /** An eligible day with no row at all — a night the close job did not run. */
  MISSING_DAY: 'MISSING_DAY',
  /** A row whose `dayType`/`status` pair belongs in no bucket. */
  UNBUCKETABLE_ROW: 'UNBUCKETABLE_ROW',
  /** A row dated outside the employee's own eligible window. */
  ROW_OUTSIDE_ELIGIBILITY: 'ROW_OUTSIDE_ELIGIBILITY',
} as const;

export type LockBlockerReason =
  (typeof LockBlockerReason)[keyof typeof LockBlockerReason];

/** The order blockers are reported in — most actionable first. */
const REASON_ORDER: readonly LockBlockerReason[] = [
  LockBlockerReason.MISSING_DAY,
  LockBlockerReason.MISSING_CHECKOUT,
  LockBlockerReason.UNRESOLVED_CONFLICT,
  LockBlockerReason.UNBUCKETABLE_ROW,
  LockBlockerReason.ROW_OUTSIDE_ELIGIBILITY,
];

/**
 * Dates listed per blocker before the list is truncated.
 *
 * A site whose cron died for a week produces a blocker per employee per day. The
 * full count still travels, so nothing is hidden — only the enumeration stops,
 * because a forty-thousand-line 409 is not a more useful answer than a readable
 * one.
 */
export const MAX_REPORTED_DATES = 10;

/** A stored row plus the one field only validation cares about. */
export type ValidatableRow = SummaryRow & { hasConflict: boolean };

/** One employee's month, as validation receives it. */
export interface LockCandidate {
  /** The badge code, not the uuid — this list is read by a person. */
  employeeId: string;
  /** `null` when the employee was not on rolls during the period at all. */
  window: DateWindow | null;
  /** Every row that employee has inside the *period's* bounds. */
  rows: readonly ValidatableRow[];
}

export interface LockBlocker {
  employeeId: string;
  reason: LockBlockerReason;
  /** How many days are affected, whatever `dates` was truncated to. */
  count: number;
  /** `yyyy-MM-dd`, at most `MAX_REPORTED_DATES` of them. */
  dates: string[];
}

export function findLockBlockers(input: {
  employees: readonly LockCandidate[];
  isPaidByAbsenceId: ReadonlyMap<string, boolean>;
}): LockBlocker[] {
  const blockers: LockBlocker[] = [];

  for (const employee of input.employees) {
    // Not on rolls during the period: no window, no rows expected, and no
    // summary will be generated for them either. Nothing to block.
    if (employee.window === null) continue;

    const found = new Map<LockBlockerReason, string[]>();

    const add = (reason: LockBlockerReason, date: Date) => {
      const dates = found.get(reason) ?? [];

      dates.push(toDateKey(date));
      found.set(reason, dates);
    };

    const covered = new Set<string>();

    for (const row of employee.rows) {
      if (!isWithinWindow(row.attendanceDate, employee.window)) {
        add(LockBlockerReason.ROW_OUTSIDE_ELIGIBILITY, row.attendanceDate);
        continue;
      }

      covered.add(toDateKey(row.attendanceDate));

      if (row.status === AttendanceStatus.MISSING_CHECKOUT) {
        add(LockBlockerReason.MISSING_CHECKOUT, row.attendanceDate);
      }

      if (row.hasConflict) {
        add(LockBlockerReason.UNRESOLVED_CONFLICT, row.attendanceDate);
      }

      // Checked after the two above so a row that is both incomplete *and*
      // unclassifiable reports the reason a human can act on first. The status
      // that produces it is usually MISSING_CHECKOUT anyway, which is why this
      // branch mostly catches NOT_APPLICABLE on a working day — a contradiction
      // nothing in the module is supposed to be able to write.
      if (
        bucketDay(row, input.isPaidByAbsenceId) === DayBucket.UNBUCKETABLE &&
        row.status !== AttendanceStatus.MISSING_CHECKOUT
      ) {
        add(LockBlockerReason.UNBUCKETABLE_ROW, row.attendanceDate);
      }
    }

    // Days with no row at all. This is the branch that catches an employee with
    // no shift assigned — the close job skips them, so they arrive here with an
    // empty month rather than a wrong one.
    for (const date of eachDateInRange(
      employee.window.from,
      employee.window.to,
    )) {
      if (!covered.has(toDateKey(date))) {
        add(LockBlockerReason.MISSING_DAY, date);
      }
    }

    for (const reason of REASON_ORDER) {
      const dates = found.get(reason);

      if (!dates || dates.length === 0) continue;

      blockers.push({
        employeeId: employee.employeeId,
        reason,
        count: dates.length,
        dates: dates.slice(0, MAX_REPORTED_DATES),
      });
    }
  }

  return blockers;
}
