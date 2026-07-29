import { Module } from '@nestjs/common';
import { GovtIdsService } from './govt-ids.service.js';
import { GovtIdsController } from './govt-ids.controller.js';

@Module({
  controllers: [GovtIdsController],
  providers: [GovtIdsService],
})
export class GovtIdsModule {}
