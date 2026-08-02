import { Module } from '@nestjs/common';
import { AnnouncementService } from './announcement.service.js';
import { AnnouncementController } from './announcement.controller.js';

@Module({
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
})
export class AnnouncementModule {}
