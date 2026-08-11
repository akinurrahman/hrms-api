import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { HolidayService } from './holiday.service.js';
import { CreateHolidayDto } from './dto/create-holiday.dto.js';
import { UpdateHolidayDto } from './dto/update-holiday.dto.js';
import { FindHolidayDto } from './dto/find-holiday.dto.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

/**
 * Writes are admin-only; reads are open to any authenticated user, since an
 * employee's own attendance view has to render the holiday calendar.
 */
@Roles(Role.SITE_ADMIN)
@Controller('holidays')
export class HolidayController {
  constructor(private readonly holidayService: HolidayService) {}

  @Post()
  @ResponseMessage('Holiday created successfully!')
  create(@Body() dto: CreateHolidayDto) {
    return this.holidayService.create(dto);
  }

  @Get()
  @Roles(Role.SITE_ADMIN, Role.EMPLOYEE)
  @ResponseMessage('Holidays fetched successfully!')
  findAll(@Query() query: FindHolidayDto) {
    return this.holidayService.findAll(query);
  }

  @Get(':id')
  @Roles(Role.SITE_ADMIN, Role.EMPLOYEE)
  @ResponseMessage('Holiday fetched successfully!')
  findOne(@Param('id') id: string) {
    return this.holidayService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Holiday updated successfully!')
  update(@Param('id') id: string, @Body() dto: UpdateHolidayDto) {
    return this.holidayService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('Holiday deleted successfully!')
  remove(@Param('id') id: string) {
    return this.holidayService.remove(id);
  }
}
