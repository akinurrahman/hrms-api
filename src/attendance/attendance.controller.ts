import { Body, Controller, Post } from '@nestjs/common';
import { AttendanceDerivationService } from './attendance-derivation.service.js';
import { DeriveAttendanceDto } from './dto/derive-attendance.dto.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Roles(Role.SITE_ADMIN)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly derivationService: AttendanceDerivationService) {}

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
