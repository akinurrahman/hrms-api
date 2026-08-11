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
import { ShiftService } from './shift.service.js';
import { CreateShiftDto } from './dto/create-shift.dto.js';
import { UpdateShiftDto } from './dto/update-shift.dto.js';
import { FindShiftDto } from './dto/find-shift.dto.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Roles(Role.SITE_ADMIN)
@Controller('shifts')
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Post()
  @ResponseMessage('Shift created successfully!')
  create(@Body() dto: CreateShiftDto) {
    return this.shiftService.create(dto);
  }

  @Get()
  @ResponseMessage('Shifts fetched successfully!')
  findAll(@Query() query: FindShiftDto) {
    return this.shiftService.findAll(query);
  }

  @Get(':id')
  @ResponseMessage('Shift fetched successfully!')
  findOne(@Param('id') id: string) {
    return this.shiftService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Shift updated successfully!')
  update(@Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.shiftService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('Shift deleted successfully!')
  remove(@Param('id') id: string) {
    return this.shiftService.remove(id);
  }
}
