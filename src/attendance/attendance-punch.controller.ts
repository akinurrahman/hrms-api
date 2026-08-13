import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AttendancePunchService } from './attendance-punch.service.js';
import { CreatePunchBatchDto } from './dto/create-punch.dto.js';
import { FindPunchDto } from './dto/find-punch.dto.js';
import { Public, ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { DeviceAuthGuard } from '../auth/guards/device-auth.guard.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('attendance')
export class AttendancePunchController {
  constructor(private readonly punchService: AttendancePunchService) {}

  /**
   * `@Public()` releases the global `JwtAuthGuard`, not the route. Global
   * guards run before route-level ones, so `DeviceAuthGuard` still stands in
   * front of this — a device has no JWT to present. `RolesGuard` passes
   * because no `@Roles()` is declared.
   */
  @Post('punches')
  @Public()
  @UseGuards(DeviceAuthGuard)
  @ResponseMessage('Punches ingested successfully!')
  ingest(@Body() dto: CreatePunchBatchDto) {
    return this.punchService.ingest(dto);
  }

  @Get('punches')
  @Roles(Role.SITE_ADMIN)
  @ResponseMessage('Punches fetched successfully!')
  findAll(@Query() query: FindPunchDto) {
    return this.punchService.findAll(query);
  }
}
