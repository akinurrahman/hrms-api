import { Module } from '@nestjs/common';
import { HolidayModule } from '../holiday/holiday.module.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import { AttendancePunchController } from './attendance-punch.controller.js';
import { AttendancePunchService } from './attendance-punch.service.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceDerivationService } from './attendance-derivation.service.js';
import { AttendanceRosterService } from './attendance-roster.service.js';
import { AttendanceAuditService } from './attendance-audit.service.js';
import { AttendanceCloseScheduler } from './attendance-close.scheduler.js';
import { AttendanceCloseService } from './attendance-close.service.js';
import { AttendanceLeaveService } from './attendance-leave.service.js';
import { AttendanceOverrideService } from './attendance-override.service.js';
import { AttendancePeriodController } from './attendance-period.controller.js';
import { AttendancePeriodService } from './attendance-period.service.js';

@Module({
  imports: [HolidayModule],
  controllers: [
    AttendancePunchController,
    AttendanceController,
    AttendancePeriodController,
  ],
  providers: [
    // First because it is now a dependency of three of its siblings: nothing
    // writes attendance without asking it whether the period is open.
    AttendancePeriodService,
    AttendancePolicyService,
    AttendancePunchService,
    AttendanceDerivationService,
    AttendanceRosterService,
    AttendanceAuditService,
    AttendanceLeaveService,
    AttendanceOverrideService,
    AttendanceCloseService,
    // Not exported: nothing calls a scheduler, it calls things. Registering it
    // as a provider is what makes `@Cron` discover it.
    AttendanceCloseScheduler,
  ],
  // `AttendanceLeaveService` is the seam the leave module writes through on
  // approval. The dependency points one way — LeaveModule imports this one, not
  // the reverse — so neither module needs a forwardRef to be constructed.
  //
  // `AttendancePeriodService` is exported for the same reason: leave's own write
  // paths reach attendance rows, so they have to ask the same guard.
  exports: [
    AttendancePeriodService,
    AttendancePolicyService,
    AttendancePunchService,
    AttendanceDerivationService,
    AttendanceLeaveService,
    AttendanceOverrideService,
    AttendanceCloseService,
  ],
})
export class AttendanceModule {}
