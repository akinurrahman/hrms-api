import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';

/**
 * What an approved leave does to the attendance rows that already exist for the
 * days it covers. Pure: no database, no Nest, no host clock.
 *
 * The model is called `PlannedAbsence`, but the common real case is retroactive.
 * The employee is absent Tuesday, the close job writes ABSENT, the leave is filed
 * Thursday. If approval only affected future days, that Tuesday stays ABSENT
 * forever and payroll deducts a day that was approved — so approval has to reach
 * backwards.
 *
 * How far backwards is the whole question, and the answer is source precedence
 * again: leave approval speaks with SYSTEM's authority, so it may correct what
 * SYSTEM decided and nothing more. A day with a punch on it, or a day HR marked
 * by hand, is evidence that contradicts the leave. That contradiction is real —
 * somebody was at work on a day they are now recorded as being on leave — and it
 * is flagged for a human rather than resolved by whichever write happened to land
 * last.
 */

/** The stored row reduced to what the decision depends on. */
export interface ConvertibleRow {
  id: string;
  attendanceDate: Date;
  dayType: DayType;
  status: AttendanceStatus;
  source: AttendanceSource;
  plannedAbsenceId: string | null;
}

/** Convert this row: it is SYSTEM's, and SYSTEM was wrong about the day. */
export interface ConversionPlan {
  attendanceId: string;
  data: {
    status: AttendanceStatus;
    plannedAbsenceId: string;
    checkIn: null;
    checkOut: null;
    workedMinutes: 0;
    lateMinutes: 0;
    earlyExitMinutes: 0;
    overtimeMinutes: 0;
  };
}

/** Do not convert this row. Flag the contradiction and let HR decide. */
export interface ConflictPlan {
  attendanceId: string;
  data: {
    hasConflict: true;
    conflictNote: string;
  };
}

export interface LeaveConversionResult {
  converted: ConversionPlan[];
  conflicted: ConflictPlan[];
}

export interface PlanLeaveConversionInput {
  /** Existing rows for the covered dates. Days with no row are simply absent here. */
  rows: ConvertibleRow[];
  absenceId: string;
  /** `LeaveType.code` — goes into the conflict note, which a human reads. */
  leaveCode: string;
}

export function planLeaveConversion(
  input: PlanLeaveConversionInput,
): LeaveConversionResult {
  const converted: ConversionPlan[] = [];
  const conflicted: ConflictPlan[] = [];

  for (const row of input.rows) {
    // A day with no row is not in `rows` at all, and that is the correct
    // outcome: it is a future date the close job has not reached, and creating
    // the row here would break the rule that a row means the day was decided.

    // Leave on a rest day is not a leave day. The employee was not due at work,
    // nothing is deducted, and converting it would consume a day of balance for
    // a Sunday.
    if (row.dayType !== DayType.WORKING) continue;

    // Already pointed at this absence — re-approving or re-running the same
    // conversion has to be a no-op, or an idempotent retry starts producing
    // audit noise for changes that did not happen.
    if (row.plannedAbsenceId === input.absenceId) continue;

    // The precedence rule, stated as itself. Approval carries SYSTEM's
    // authority; DEVICE and MANUAL both outrank it.
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

    converted.push({
      attendanceId: row.id,
      data: {
        status: AttendanceStatus.ON_LEAVE,
        plannedAbsenceId: input.absenceId,
        // A leave day has no times and no minutes. Leaving stale values behind
        // would leave the row claiming hours worked on a day off.
        checkIn: null,
        checkOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
      },
    });
  }

  return { converted, conflicted };
}

/**
 * `source` stays whatever it was. Approval is not a manual edit and not a device
 * reading — it corrects a SYSTEM row on SYSTEM's own terms, and promoting it to
 * MANUAL would make the nightly close job stop treating the row as its own.
 */
function conflictNote(row: ConvertibleRow, leaveCode: string): string {
  const owner =
    row.source === AttendanceSource.MANUAL
      ? 'was marked by hand'
      : 'was recorded from device punches';

  return `Approved ${leaveCode} covers this day, but the row ${owner} as ${row.status}. Review and decide.`;
}
