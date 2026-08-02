import { Module } from '@nestjs/common';
import { AssetService } from './asset.service.js';
import { AssetController } from './asset.controller.js';

@Module({
  controllers: [AssetController],
  providers: [AssetService],
})
export class AssetModule {}
