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
