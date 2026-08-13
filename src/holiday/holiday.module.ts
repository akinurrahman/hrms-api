import { Module } from '@nestjs/common';
import { HolidayService } from './holiday.service.js';
import { HolidayController } from './holiday.controller.js';

@Module({
  controllers: [HolidayController],
  providers: [HolidayService],
  exports: [HolidayService],
})
export class HolidayModule {}
