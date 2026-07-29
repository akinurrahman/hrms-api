import { Module } from '@nestjs/common';
import { FamilyInfoService } from './family-info.service.js';
import { FamilyInfoController } from './family-info.controller.js';

@Module({
  controllers: [FamilyInfoController],
  providers: [FamilyInfoService],
})
export class FamilyInfoModule {}
