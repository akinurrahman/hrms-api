import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AttendancePeriodService } from './attendance-period.service.js';
import { CreateAttendancePeriodDto } from './dto/create-attendance-period.dto.js';
import { FindAttendancePeriodDto } from './dto/find-attendance-period.dto.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

/**
 * Payroll cycles. Admin-only throughout, reads included — which period is locked
 * is a payroll fact, and an employee's own attendance view has no use for it.
 * (Contrast `HolidayController`, whose reads are open because the employee
 * calendar has to render them.)
 *
 * No PATCH and no DELETE, deliberately. Moving a period's boundaries once rows
 * exist inside them silently re-scopes what is locked, with nothing downstream
 * able to notice and no undo. Lock and unlock — Phase 11 — are the only mutations
 * this entity will ever get, and both of them record who did it and why.
 */
@Roles(Role.SITE_ADMIN)
@Controller('attendance-periods')
export class AttendancePeriodController {
  constructor(private readonly periodService: AttendancePeriodService) {}

  @Post()
  @ResponseMessage('Attendance period created successfully!')
  create(@Body() dto: CreateAttendancePeriodDto) {
    return this.periodService.create(dto);
  }

  @Get()
  @ResponseMessage('Attendance periods fetched successfully!')
  findAll(@Query() query: FindAttendancePeriodDto) {
    return this.periodService.findAll(query);
  }

  @Get(':id')
  @ResponseMessage('Attendance period fetched successfully!')
  findOne(@Param('id') id: string) {
    return this.periodService.findOne(id);
  }
}
