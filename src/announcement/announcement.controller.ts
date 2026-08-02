import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { AnnouncementService } from './announcement.service.js';
import { CreateAnnouncementDto } from './dto/create-announcement.dto.js';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto.js';
import { FindAnnouncementDto } from './dto/find-announcement.dto.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('announcements')
@Roles(Role.SITE_ADMIN)
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Post()
  @ResponseMessage('Announcement created successfully!')
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: Express.User,
  ) {
    if (!user.employeeId) {
      throw new ForbiddenException(
        'No employee profile linked to this account',
      );
    }
    return this.announcementService.create(dto, user.employeeId);
  }

  @Roles(Role.SITE_ADMIN, Role.EMPLOYEE)
  @Get()
  @ResponseMessage('Announcements fetched successfully!')
  findAll(@Query() query: FindAnnouncementDto) {
    return this.announcementService.findAll(query);
  }

  @Roles(Role.SITE_ADMIN, Role.EMPLOYEE)
  @Get(':id')
  @ResponseMessage('Announcement fetched successfully!')
  findOne(@Param('id') id: string) {
    return this.announcementService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Announcement updated successfully!')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcementService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('Announcement deleted successfully!')
  remove(@Param('id') id: string) {
    return this.announcementService.remove(id);
  }
}
