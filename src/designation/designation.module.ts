import { Module } from '@nestjs/common';
import { DesignationService } from './designation.service.js';
import { DesignationController } from './designation.controller.js';

@Module({
  controllers: [DesignationController],
  providers: [DesignationService],
})
export class DesignationModule {}
