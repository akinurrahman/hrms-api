import {
  AttendanceSource,
  AttendanceStatus,
  DayType,
} from '../constants/attendance-enums.js';
import { resolveDayType } from './derive-day.js';

/**
 * What the roster shows for one employee on one date. Pure: no database, no
 * Nest, no host clock — the same split `deriveDay()` and `aggregate()` already
 * make.
 *
 * The whole value of the roster screen is that HR can tell three states apart:
 * not marked, marked by a device, marked by a human. That only works because
 * nothing pre-creates blank rows at midnight, so for most employee-days there
 * is no `Attendance` row to read and the state has to be *computed*.
 *
 * Everything here is response-only. Nothing this function returns is ever
 * written — "a row exists" has to keep meaning "this day has been decided".
 */

/**
 * No row yet. Deliberately not an `AttendanceStatus`: the enum's members are all
 * decisions about what the employee did, and "nobody has decided" is not one of
 * them. Adding it to the enum would put a value in the database's type that must
 * never reach the database.
 */
export const ROSTER_NOT_MARKED = 'NOT_MARKED' as const;

export type RosterStatus = AttendanceStatus | typeof ROSTER_NOT_MARKED;

/** The stored row reduced to what the display state depends on. */
export interface RosterAttendance {
  dayType: DayType;
  status: AttendanceStatus;
  source: AttendanceSource;
  hasConflict: boolean;
}

export interface ResolveRosterStateInput {
  /** UTC midnight of the business-local date being viewed. */
  attendanceDate: Date;
  isHoliday: boolean;
  /** `null` when the employee has no shift assigned — see below. */
  weeklyOffDays: number[] | null;
  attendance: RosterAttendance | null;
  isFuture: boolean;
  /**
   * An approved `PlannedAbsence` covers this date.
   *
   * A boolean rather than the absence itself, because the only thing the display
   * state depends on is whether one exists. The record is returned alongside the
   * row so the screen can name the leave type; keeping it out of here keeps this
   * function about one question.
   */
  hasPlannedAbsence: boolean;
}

export interface RosterState {
  dayType: DayType;
  status: RosterStatus;
  /** An `Attendance` row exists: this day has been decided. */
  isMarked: boolean;
  source: AttendanceSource | null;
  hasConflict: boolean;
  /** False for future dates. HR may look, not mark. */
  isEditable: boolean;
  /** PRD §9 case 13 — surfaced per row so HR can fix it, never assumed away. */
  noShiftAssigned: boolean;
}

export function resolveRosterState(
  input: ResolveRosterStateInput,
): RosterState {
  const { attendance, weeklyOffDays, isFuture } = input;

  // Future dates are read-only (PRD §6.3). Without the rule somebody marks the
  // whole team present for next week; pre-approved absence goes through
  // `PlannedAbsence` instead.
  const isEditable = !isFuture;
  const noShiftAssigned = weeklyOffDays === null;

  // A stored row outranks every computed state, whatever produced it. The
  // computation below is a description of a day nobody has answered yet, not a
  // second opinion about one that has been.
  if (attendance) {
    return {
      dayType: attendance.dayType,
      status: attendance.status,
      isMarked: true,
      source: attendance.source,
      hasConflict: attendance.hasConflict,
      isEditable,
      noShiftAssigned,
    };
  }

  // Without a shift the weekly-off question is unanswerable, and answering it
  // anyway — defaulting to Sunday, say — would show a rest day the employee may
  // not have. WORKING is the honest reading, and `noShiftAssigned` is what HR is
  // meant to act on.
  const dayType = resolveDayType(
    input.attendanceDate,
    weeklyOffDays ?? [],
    input.isHoliday,
  );

  // An approved absence answers the day even though nothing has been written
  // yet. Still response-only: no row is created here, so the day stays undecided
  // (`isMarked` false) until a punch, HR, or the close job decides it. On a
  // holiday or weekly off the leave is not shown, because the employee was not
  // due at work and no leave is being consumed.
  const isOnLeave = input.hasPlannedAbsence && dayType === DayType.WORKING;

  return {
    dayType,
    status: isOnLeave ? AttendanceStatus.ON_LEAVE : ROSTER_NOT_MARKED,
    isMarked: false,
    source: null,
    hasConflict: false,
    isEditable,
    noShiftAssigned,
  };
}
