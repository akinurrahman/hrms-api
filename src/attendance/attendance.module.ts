import { Module } from '@nestjs/common';
import { AttendancePolicyService } from './attendance-policy.service.js';
import { AttendancePunchController } from './attendance-punch.controller.js';
import { AttendancePunchService } from './attendance-punch.service.js';

@Module({
  controllers: [AttendancePunchController],
  providers: [AttendancePolicyService, AttendancePunchService],
  exports: [AttendancePolicyService, AttendancePunchService],
})
export class AttendanceModule {}
