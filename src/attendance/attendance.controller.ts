import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AttendanceDerivationService } from './attendance-derivation.service.js';
import { AttendanceRosterService } from './attendance-roster.service.js';
import { DeriveAttendanceDto } from './dto/derive-attendance.dto.js';
import { FindRosterDto } from './dto/find-roster.dto.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Roles(Role.SITE_ADMIN)
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly derivationService: AttendanceDerivationService,
    private readonly rosterService: AttendanceRosterService,
  ) {}

  /**
   * One day, every employee on rolls for it.
   *
   * Purely a read. Days nobody has decided come back with a computed
   * description and no `Attendance` row, which is what lets HR see the
   * difference between "nothing happened here yet" and "this was marked".
   */
  @Get('roster')
  @ResponseMessage('Roster fetched successfully!')
  findRoster(@Query() query: FindRosterDto) {
    return this.rosterService.findRoster(query);
  }

  /**
   * Recompute attendance from punches already stored.
   *
   * Ingestion derives inline, so this is not the routine path — it is the
   * repair one. Punches are append-only precisely so that a day can be
   * answered again after the inputs to the answer change: a fixed bug in the
   * arithmetic, a shift corrected after the fact, a holiday declared late.
   *
   * Source precedence still applies, so this can never flatten a row HR
   * decided by hand.
   */
  @Post('derive')
  @ResponseMessage('Attendance derived successfully!')
  derive(@Body() dto: DeriveAttendanceDto) {
    return this.derivationService.derive(dto);
  }
}
