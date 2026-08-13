import { Module } from '@nestjs/common';
import { AttendancePolicyService } from './attendance-policy.service.js';


@Module({
  providers: [AttendancePolicyService],
  exports: [AttendancePolicyService],
})
export class AttendanceModule {}
