import { Prisma } from '../../generated/prisma/client.js';

/**
 * "Who was on rolls on date X" — the single definition used by the roster
 * query, the nightly close job and monthly summary generation.
 *
 * Date-relative, not `isActive`-relative: viewing March must still list
 * someone who left in April.
 *
 * Returns a `where` fragment. Compose it with `AND` rather than spreading it,
 * so its `OR` does not clobber another `OR` in the same filter.
 */
export function employeeEligibleOn(date: Date): Prisma.EmployeeWhereInput {
  return {
    dateOfJoining: { lte: date },
    OR: [{ lastWorkingDay: null }, { lastWorkingDay: { gte: date } }],
  };
}

/**
 * The same predicate, answered in memory.
 *
 * Batch work — punch ingestion, the close job — loads a set of employees once
 * and then asks the question per row. Pushing that back into the database
 * would be a query per employee-day on a connection that charges for every
 * round trip.
 *
 * The two definitions must stay in step. Change one, change the other.
 */
export function isEmployeeEligibleOn(
  employee: { dateOfJoining: Date; lastWorkingDay: Date | null },
  date: Date,
): boolean {
  if (employee.dateOfJoining.getTime() > date.getTime()) return false;

  return (
    employee.lastWorkingDay === null ||
    employee.lastWorkingDay.getTime() >= date.getTime()
  );
}
