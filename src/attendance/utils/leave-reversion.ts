import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';

/**
 * What cancelling an approved absence does to the attendance rows it already
 * converted. Pure: no database, no Nest, no host clock.
 *
 * The mirror of `planLeaveConversion`, and it has to be, because approval
 * reaching backwards is only half a feature. A leave approved on Thursday flips
 * Tuesday from ABSENT to ON_LEAVE; withdrawn on Friday, Tuesday has to stop
 * being ON_LEAVE, or payroll pays for a leave nobody is taking and the only
 * trail back is a `plannedAbsenceId` pointing at a cancelled record.
 *
 * Same precedence rule, stated the same way: cancellation speaks with SYSTEM's
 * authority, so it may undo what SYSTEM did and nothing more. A day somebody has
 * since punched or HR has since marked is evidence that outranks the withdrawal,
 * and the contradiction goes to a human rather than to whichever write landed
 * last.
 *
 * What it deliberately does *not* do is work out whether the day was really an
 * absence. It reverts to ABSENT, and the caller re-derives from punches
 * afterwards — the punch log is still there, so the honest answer can always be
 * recomputed and does not need guessing at here.
 */

/** The stored row reduced to what the decision depends on. */
export interface RevertibleRow {
  id: string;
  dayType: DayType;
  status: AttendanceStatus;
  source: AttendanceSource;
  plannedAbsenceId: string | null;
}

/** Undo this row: it is SYSTEM's, and the reason it existed has been withdrawn. */
export interface ReversionPlan {
  attendanceId: string;
  data: {
    status: AttendanceStatus;
    plannedAbsenceId: null;
  };
}

/** Do not undo this row. Flag the contradiction and let HR decide. */
export interface ReversionConflictPlan {
  attendanceId: string;
  data: {
    hasConflict: true;
    conflictNote: string;
  };
}

export interface LeaveReversionResult {
  reverted: ReversionPlan[];
  conflicted: ReversionConflictPlan[];
}

export function planLeaveReversion(input: {
  /** Existing rows for the covered dates. */
  rows: RevertibleRow[];
  absenceId: string;
  /** `LeaveType.code` — goes into the conflict note, which a human reads. */
  leaveCode: string;
}): LeaveReversionResult {
  const reverted: ReversionPlan[] = [];
  const conflicted: ReversionConflictPlan[] = [];

  for (const row of input.rows) {
    // Not charged to this absence, so cancelling it says nothing about this day.
    // Covers the days the conversion refused to touch in the first place, which
    // is what makes cancel-after-a-conflicted-approval a no-op rather than a
    // second wrong write.
    if (row.plannedAbsenceId !== input.absenceId) continue;

    // The precedence rule, stated as itself. A punch or a manual mark landed
    // after the conversion; the day is no longer SYSTEM's to take back.
    if (row.source !== AttendanceSource.SYSTEM) {
      conflicted.push({
        attendanceId: row.id,
        data: {
          hasConflict: true,
          conflictNote: conflictNote(row, input.leaveCode),
        },
      });
      continue;
    }

    reverted.push({
      attendanceId: row.id,
      data: {
        // A rest day that somehow carries the link goes back to being a rest
        // day, not an absence. The employee was not due at work either way, and
        // ABSENT there would invent a deduction out of a cancellation.
        status:
          row.dayType === DayType.WORKING
            ? AttendanceStatus.ABSENT
            : AttendanceStatus.NOT_APPLICABLE,
        // The link has to go with the status. A day pointing at a cancelled
        // absence is worse than a day pointing at nothing: it reads as
        // authorised right up until somebody opens the absence record.
        plannedAbsenceId: null,
      },
    });
  }

  return { reverted, conflicted };
}

/**
 * `source` stays whatever it was, exactly as in the conversion. Withdrawal is
 * not a manual edit and not a device reading — promoting the row to MANUAL would
 * make the nightly close job stop treating it as its own.
 */
function conflictNote(row: RevertibleRow, leaveCode: string): string {
  const owner =
    row.source === AttendanceSource.MANUAL
      ? 'was marked by hand'
      : 'was recorded from device punches';

  return `The ${leaveCode} covering this day was cancelled, but the row ${owner} as ${row.status}. Review and decide.`;
}
