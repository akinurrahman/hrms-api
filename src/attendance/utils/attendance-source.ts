import { AttendanceSource } from '../constants/attendance-enums.js';

/**
 * SYSTEM < DEVICE < MANUAL.
 *
 * Explicit map rather than the enum's declaration order: the order of values in
 * a Prisma enum is a schema detail nobody expects to be load-bearing, and
 * reordering it must not silently change who outranks whom.
 */
const RANK: Record<AttendanceSource, number> = {
  [AttendanceSource.SYSTEM]: 0,
  [AttendanceSource.DEVICE]: 1,
  [AttendanceSource.MANUAL]: 2,
};

/**
 * May a write from `incoming` modify a row currently owned by `existing`?
 *
 * This is the rule the whole module rests on. Silent last-write-wins on a
 * payroll input is how you end up with a disputed salary and no explanation, so
 * a lower-ranked write does not overwrite and does not fail — it stores its
 * evidence and flags the row for a human. See `AttendanceDerivationService`.
 *
 * Equal rank overwrites. A second DEVICE derivation for the same day has to be
 * able to correct the first, or reprocessing stops being idempotent.
 *
 * @param existing source of the row as it stands, or `null` when no row exists
 */
export function canOverwrite(
  existing: AttendanceSource | null,
  incoming: AttendanceSource,
): boolean {
  if (existing === null) return true;

  return RANK[incoming] >= RANK[existing];
}
