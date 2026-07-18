import { Module } from '@nestjs/common';
import { EmployeeService } from './employee.service.js';
import { EmployeeController } from './employee.controller.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports : [UserModule],
  controllers: [EmployeeController],
  providers: [EmployeeService, ],
})
export class EmployeeModule {}
