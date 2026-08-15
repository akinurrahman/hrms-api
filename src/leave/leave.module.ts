import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { LeaveTypeController } from './leave-type.controller.js';
import { LeaveTypeService } from './leave-type.service.js';
import { PlannedAbsenceController } from './planned-absence.controller.js';
import { PlannedAbsenceService } from './planned-absence.service.js';


@Module({
  imports: [AttendanceModule],
  controllers: [LeaveTypeController, PlannedAbsenceController],
  providers: [LeaveTypeService, PlannedAbsenceService],
  exports: [LeaveTypeService, PlannedAbsenceService],
})
export class LeaveModule {}
