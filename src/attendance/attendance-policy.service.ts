import { Injectable } from '@nestjs/common';
import {
  AttendancePolicy,
  DEFAULT_ATTENDANCE_POLICY,
} from './constants/attendance-policy.constant.js';

/**
 * The one seam every attendance consumer reads its numbers through.
 *
 * `aggregate()`, the roster, the manual override path, the close job and
 * summary generation all resolve their thresholds here. None of them holds a
 * threshold of its own.
 *
 * Async and injectable deliberately, despite there being nothing to await yet.
 * When multi-tenancy lands this body becomes a cached read of a
 * `SiteAttendanceConfig` row — a synchronous function could not do that
 * without every call site changing to `await`, which is exactly the retrofit
 * the seam exists to avoid.
 */
@Injectable()
export class AttendancePolicyService {
  /**
   * @param _siteId accepted and ignored while the deployment is single-tenant.
   */
  get(_siteId?: string): Promise<AttendancePolicy> {
    // Returns a promise without being `async` only because there is nothing
    // to await yet. The signature is the contract; the body becomes a real
    // `await this.prisma.siteAttendanceConfig.findUnique(...)`.
    return Promise.resolve(DEFAULT_ATTENDANCE_POLICY);
  }
}
