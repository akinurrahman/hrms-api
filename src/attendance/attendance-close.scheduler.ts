import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { businessToday, toDateKey } from '../common/utils/date.js';
import { AttendanceCloseService } from './attendance-close.service.js';
import { AttendancePolicyService } from './attendance-policy.service.js';

/**
 * When the close runs, on the business's wall clock.
 *
 * **Not the PRD's suggested 03:00, and the PRD says to check.** Work it out from
 * what is actually configured: a night shift ending 06:00 belongs to the
 * previous day, and `punchWindowAfterMinutes` is 180, so a punch legitimately
 * attributable to yesterday can still arrive at 09:00 today. Closing at 03:00
 * would mark every night-shift worker ABSENT six hours before their punch was
 * due to be accepted.
 *
 * 11:00 clears that window with two hours in hand for a device that syncs on its
 * own schedule. Override per deployment once the real shift roster is known —
 * this is a default, not a law.
 */
const CLOSE_CRON = '0 0 11 * * *';

/**
 * The timezone the expression is read in. Without it the server's UTC clock
 * decides, and 11:00 becomes 16:30 IST.
 */
const CLOSE_TIMEZONE = 'Asia/Kolkata';

/**
 * Both of the above are constants and not environment variables, which is a
 * deliberate limitation rather than an oversight.
 *
 * `@Cron` is a decorator: its arguments are evaluated when this module is
 * imported, which is before `ConfigModule` has loaded `.env` into
 * `process.env`. An `ATTENDANCE_CLOSE_CRON` read here would work when the value
 * came from the real environment and silently fall back to the default when it
 * came from a file — a knob that appears to work and does not is worse than no
 * knob. Changing the schedule is a one-line code change that gets reviewed.
 *
 * `ATTENDANCE_CLOSE_ENABLED` is read inside the handler instead, at which point
 * `.env` has been loaded, so that one is a genuine per-environment switch.
 */

/**
 * The unattended half of the close job.
 *
 * Kept to a wrapper on purpose (build guide, Phase 9): all of the behaviour is
 * in `AttendanceCloseService.close()`, which takes a date and can therefore be
 * tested against any day at any hour. Binding the logic to a cron would mean the
 * only way to exercise it is to wait until tomorrow.
 *
 * Off unless switched on. A scheduler that fires unannounced in a dev database
 * and writes an ABSENT row for every employee is not a good first impression of
 * the feature, and the person it surprises is usually the one who least expects
 * a background job to exist.
 */
@Injectable()
export class AttendanceCloseScheduler {
  private readonly logger = new Logger(AttendanceCloseScheduler.name);

  /**
   * A slow night must not overlap itself. Two sweeps writing the same rows would
   * not corrupt anything — the job is idempotent and every write is an upsert —
   * but they would double the load on the connection at exactly the moment it is
   * already struggling, which is how a slow run becomes a failed one.
   */
  private isRunning = false;

  constructor(
    private readonly closeService: AttendanceCloseService,
    private readonly policyService: AttendancePolicyService,
  ) {}

  @Cron(CLOSE_CRON, { name: 'attendance-close', timeZone: CLOSE_TIMEZONE })
  async closeYesterday(): Promise<void> {
    if (process.env.ATTENDANCE_CLOSE_ENABLED !== 'true') return;

    if (this.isRunning) {
      this.logger.warn('Previous close is still running — skipping this tick');
      return;
    }

    this.isRunning = true;

    try {
      const date = await this.targetDate();

      const summary = await this.closeService.close({
        date,
        // Nobody asked for this run. Naming a placeholder user in the audit log
        // would put a person's id on a change they did not make, in a record a
        // payroll dispute reads as testimony.
        actorId: null,
      });

      this.logger.log(
        `Closed ${summary.date}: ${summary.created.absent} absent, ` +
          `${summary.created.onLeave} on leave, ` +
          `${summary.created.notApplicable} non-working, ` +
          `${summary.conflictsFlagged} flagged, ` +
          `${summary.untouched} already answered`,
      );

      // Loud, because it is the one outcome nothing else will surface. A
      // shift-less employee produces no row at all, so they are simply missing
      // from the month rather than visibly wrong in it — until the lock refuses.
      if (summary.skipped.length > 0) {
        this.logger.warn(
          `Skipped ${summary.skipped.length} employee(s) with no shift assigned: ` +
            summary.skipped.map((skip) => skip.employeeId).join(', '),
        );
      }
    } catch (error) {
      // Swallowed deliberately. An unhandled rejection out of a cron callback
      // takes the process down, and losing the API because last night's close
      // failed turns a recoverable problem into an outage. The endpoint is the
      // recovery path.
      this.logger.error(
        `Nightly close failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Yesterday on the business's wall clock.
   *
   * Reading the host's date would answer this wrong for several hours a day, and
   * the close job is precisely the caller that cannot afford it: closing the
   * wrong day marks the whole headcount absent for a day that has not finished.
   */
  private async targetDate(): Promise<Date> {
    const policy = await this.policyService.get();
    const today = businessToday(policy.businessUtcOffsetMinutes);

    // Walk the UTC calendar field rather than subtracting 86,400,000ms, so the
    // result stays UTC midnight and compares cleanly against a `@db.Date`.
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    this.logger.log(`Closing ${toDateKey(yesterday)}`);

    return yesterday;
  }
}
