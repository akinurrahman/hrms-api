import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';
import { resolveDayType } from './derive-day.js';

/**
 * What the nightly close job does about one employee-day. Pure: no database, no
 * Nest, no host clock — the same split `aggregate()`, `deriveDay()` and
 * `resolveRosterState()` already make.
 *
 * This is the only place in the module that is *allowed* to invent a row.
 * Derivation deliberately refuses to (see its class comment): a day with no
 * punches is only an absence once you have ruled out a holiday, a weekly off and
 * approved leave, and derivation knows about none of the three. This function
 * gets all of them handed to it, which is what earns it the right to decide.
 *
 * Everything it creates is `SYSTEM` — the lowest rank there is. A row it writes
 * tonight is a placeholder that any punch or any human may still overwrite
 * without argument, and that is the point: the close job fills silence, it does
 * not answer questions somebody else already answered.
 */

/** Why an employee-day produced no decision. Never silent — always reported. */
export const CloseSkipReason = {
  NO_SHIFT_ASSIGNED: 'NO_SHIFT_ASSIGNED',
} as const;

export type CloseSkipReason =
  (typeof CloseSkipReason)[keyof typeof CloseSkipReason];

/** The stored row reduced to what the decision depends on. */
export interface ClosableRow {
  id: string;
  source: AttendanceSource;
  status: AttendanceStatus;
  checkIn: Date | null;
  checkOut: Date | null;
  hasConflict: boolean;
  plannedAbsenceId: string | null;
}

export interface CloseDayInput {
  /** UTC midnight of the business-local date, as a `@db.Date` column stores it. */
  attendanceDate: Date;
  /** `null` when the employee has no shift assigned — see PRD §9 case 13. */
  shift: { id: string; weeklyOffDays: number[] } | null;
  isHoliday: boolean;
  existing: ClosableRow | null;
  /** An approved `PlannedAbsence` covering this date, if any. */
  leave: { id: string } | null;
}

/** The row the job writes when nothing has decided the day. */
export interface CloseCreateData {
  shiftId: string;
  dayType: DayType;
  status: AttendanceStatus;
  /** Always SYSTEM. Narrowed so the type states the safety argument above. */
  source: typeof AttendanceSource.SYSTEM;
  plannedAbsenceId: string | null;
  checkIn: null;
  checkOut: null;
  workedMinutes: 0;
  lateMinutes: 0;
  earlyExitMinutes: 0;
  overtimeMinutes: 0;
}

export type CloseDayAction =
  | { kind: 'SKIP'; reason: CloseSkipReason }
  | { kind: 'NOOP' }
  | { kind: 'CREATE'; data: CloseCreateData }
  | { kind: 'FLAG_CONFLICT'; data: { hasConflict: true; conflictNote: string } }
  | {
      kind: 'FIX_MISSING_CHECKOUT';
      data: { status: typeof AttendanceStatus.MISSING_CHECKOUT };
    };

export function planCloseDay(input: CloseDayInput): CloseDayAction {
  const { shift, existing, leave } = input;

  // PRD §9 case 13, and the PRD calls it out as worth a hard guard. Without a
  // shift there is no weekly-off list and nothing to judge the day against;
  // assuming a 9-to-6 would produce plausible-looking wrong numbers, which is
  // worse than producing none. Mirrors `AttendanceDerivationService`.
  if (!shift)
    return { kind: 'SKIP', reason: CloseSkipReason.NO_SHIFT_ASSIGNED };

  if (existing) return planExisting(existing, leave);

  const dayType = resolveDayType(
    input.attendanceDate,
    shift.weeklyOffDays,
    input.isHoliday,
  );

  const base = {
    shiftId: shift.id,
    source: AttendanceSource.SYSTEM,
    checkIn: null,
    checkOut: null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
  } as const;

  // A rest day nobody worked. NOT_APPLICABLE rather than ABSENT: the employee
  // was not due at work, so there is nothing to be absent from, and payroll must
  // not see a deduction. Checked before leave, because leave on a holiday
  // consumes no balance — the day was already free.
  if (dayType !== DayType.WORKING) {
    return {
      kind: 'CREATE',
      data: {
        ...base,
        dayType,
        status: AttendanceStatus.NOT_APPLICABLE,
        plannedAbsenceId: null,
      },
    };
  }

  // Approved leave on a working day. `plannedAbsenceId` is set here and not
  // merely implied: it is the only path from an attendance day back to the leave
  // type it was charged to (PRD §5.8), and payroll disputes turn on exactly that.
  if (leave) {
    return {
      kind: 'CREATE',
      data: {
        ...base,
        dayType: DayType.WORKING,
        status: AttendanceStatus.ON_LEAVE,
        plannedAbsenceId: leave.id,
      },
    };
  }

  // Due at work, no punches, no leave. This is the row the whole job exists to
  // write — an absence that leaves no trace is an absence payroll never sees.
  return {
    kind: 'CREATE',
    data: {
      ...base,
      dayType: DayType.WORKING,
      status: AttendanceStatus.ABSENT,
      plannedAbsenceId: null,
    },
  };
}

/**
 * A row exists, so the day has already been decided by something that outranks
 * SYSTEM. The job's remaining business here is to *observe* — flag what looks
 * wrong, correct what the row says about itself — never to re-decide.
 *
 * Every branch is guarded on the change not having been made already. That is
 * what makes the second run of the same date a no-op rather than a fresh round
 * of identical writes and audit entries.
 */
function planExisting(
  existing: ClosableRow,
  leave: { id: string } | null,
): CloseDayAction {
  // PRD §9 case 8 — "on leave but showed up". Two records contradict each other
  // and neither is obviously wrong: the punch is real and the approval is real.
  // Flagging beats resolving, because HR is the party that can ask the employee
  // whether to restore the leave day.
  //
  // A row already pointing at an absence is not a contradiction, whichever one
  // it points at: it was written *because* of leave, not in spite of it.
  const contradictsLeave =
    leave !== null &&
    existing.status !== AttendanceStatus.ON_LEAVE &&
    existing.plannedAbsenceId === null;

  if (contradictsLeave && !existing.hasConflict) {
    return {
      kind: 'FLAG_CONFLICT',
      data: {
        hasConflict: true,
        conflictNote: `Approved leave covers this day, but it is recorded as ${existing.status}. Review and decide.`,
      },
    };
  }

  // Checked after the conflict, deliberately. A row that is both contradicted
  // and incomplete has the contradiction as its more urgent problem, and that is
  // the one a human acts on.
  if (needsMissingCheckout(existing)) {
    return {
      kind: 'FIX_MISSING_CHECKOUT',
      data: { status: AttendanceStatus.MISSING_CHECKOUT },
    };
  }

  return { kind: 'NOOP' };
}

/**
 * The row's own times contradict its status: somebody checked in and never
 * checked out, but the status claims the day is settled.
 *
 * This is the one place the close job touches a row it does not own, so the
 * justification matters. MISSING_CHECKOUT is not a verdict on what the employee
 * did — the override service refuses it as an assertable status precisely
 * because no human ever *decides* it — it is a statement that the record is
 * incomplete, and its job is to block the month lock until somebody completes
 * it. Restating a fact the row already carries overrides nobody.
 *
 * MANUAL rows are still exempt. There, a human typed the times in and left the
 * status where they left it, and second-guessing that is a decision, not an
 * observation.
 */
function needsMissingCheckout(row: ClosableRow): boolean {
  return (
    row.source !== AttendanceSource.MANUAL &&
    row.checkIn !== null &&
    row.checkOut === null &&
    row.status !== AttendanceStatus.MISSING_CHECKOUT
  );
}
