import { Module } from '@nestjs/common';
import { EmploymentHistoryService } from './employment-history.service.js';
import { EmploymentHistoryController } from './employment-history.controller.js';

@Module({
  controllers: [EmploymentHistoryController],
  providers: [EmploymentHistoryService],
})
export class EmploymentHistoryModule {}
