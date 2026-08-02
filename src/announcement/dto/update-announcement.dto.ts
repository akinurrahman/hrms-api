import { PartialType } from '@nestjs/mapped-types';
import { CreateAnnouncementDto } from './create-announcement.dto.js';

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}
