import { Module } from '@nestjs/common';
import { ShiftService } from './shift.service.js';
import { ShiftController } from './shift.controller.js';

@Module({
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftModule {}
