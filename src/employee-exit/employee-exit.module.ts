import { Module } from '@nestjs/common';
import { EmployeeExitService } from './employee-exit.service.js';
import { EmployeeExitController } from './employee-exit.controller.js';

@Module({
  controllers: [EmployeeExitController],
  providers: [EmployeeExitService],
})
export class EmployeeExitModule {}
