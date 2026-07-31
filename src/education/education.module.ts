import { Module } from '@nestjs/common';
import { EducationService } from './education.service.js';
import { EducationController } from './education.controller.js';

@Module({
  controllers: [EducationController],
  providers: [EducationService],
})
export class EducationModule {}
