import { Module } from '@nestjs/common';
import { HolidayModule } from '../holiday/holiday.module.js';
import { AttendancePolicyService } from './attendance-policy.service.js';
import { AttendancePunchController } from './attendance-punch.controller.js';
import { AttendancePunchService } from './attendance-punch.service.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceDerivationService } from './attendance-derivation.service.js';
import { AttendanceRosterService } from './attendance-roster.service.js';
import { AttendanceAuditService } from './attendance-audit.service.js';
import { AttendanceOverrideService } from './attendance-override.service.js';

@Module({
  imports: [HolidayModule],
  controllers: [AttendancePunchController, AttendanceController],
  providers: [
    AttendancePolicyService,
    AttendancePunchService,
    AttendanceDerivationService,
    AttendanceRosterService,
    AttendanceAuditService,
    AttendanceOverrideService,
  ],
  exports: [
    AttendancePolicyService,
    AttendancePunchService,
    AttendanceDerivationService,
    AttendanceOverrideService,
  ],
})
export class AttendanceModule {}
