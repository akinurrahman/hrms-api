import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AttendanceAuditService } from './attendance-audit.service.js';
import { AttendanceCloseService } from './attendance-close.service.js';
import { AttendanceDerivationService } from './attendance-derivation.service.js';
import { AttendanceMonthlyService } from './attendance-monthly.service.js';
import { AttendanceOverrideService } from './attendance-override.service.js';
import { AttendanceRosterService } from './attendance-roster.service.js';
import { BulkOverrideAttendanceDto } from './dto/bulk-override-attendance.dto.js';
import { CloseAttendanceDto } from './dto/close-attendance.dto.js';
import { DeriveAttendanceDto } from './dto/derive-attendance.dto.js';
import { FindMonthlyDto } from './dto/find-monthly.dto.js';
import { FindRosterDto } from './dto/find-roster.dto.js';
import { OverrideAttendanceDto } from './dto/override-attendance.dto.js';
import { PaginationQueryDto, ResponseMessage } from '../common/index.js';
import { parseDateOnlyOrThrow } from '../common/utils/date.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Roles(Role.SITE_ADMIN)
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly derivationService: AttendanceDerivationService,
    private readonly rosterService: AttendanceRosterService,
    private readonly monthlyService: AttendanceMonthlyService,
    private readonly overrideService: AttendanceOverrideService,
    private readonly closeService: AttendanceCloseService,
    private readonly auditService: AttendanceAuditService,
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
   * One payroll cycle: employees down, days across, totals on the right.
   *
   * The screen a month is reviewed on before it is locked, so its totals are
   * computed by the same function that writes the locked snapshot — the sheet
   * and payroll's input cannot disagree.
   *
   * `year`/`month` is the cycle's label, not a calendar filter: a 26-to-25 cycle
   * labelled August starts in July, and this returns that cycle.
   *
   * Declared before the `:id`-shaped routes below so `monthly` is never read as
   * an id, for the same reason `roster` and `bulk` are.
   */
  @Get('monthly')
  @ResponseMessage('Monthly attendance fetched successfully!')
  findMonthly(@Query() query: FindMonthlyDto) {
    return this.monthlyService.findMonthly(query);
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

  /**
   * Close a finished day: every employee on rolls who has no row gets one.
   *
   * The cron calls the same method, so this is not a debug hatch — it is the
   * repair path for a night the scheduler was down, and the way a past date gets
   * closed without waiting until tomorrow.
   *
   * Idempotent. Running it twice for the same date writes nothing the second
   * time, which is what makes it safe to retry after a partial failure.
   */
  @Post('close')
  @ResponseMessage('Attendance closed successfully!')
  close(
    @Query() query: CloseAttendanceDto,
    @CurrentUser() user: Express.User,
  ) {
    return this.closeService.close({
      date: parseDateOnlyOrThrow(query.date),
      actorId: user.sub,
    });
  }

  /**
   * The roster screen's save: many employees, one date, one transaction.
   *
   * All-or-nothing. A partially applied batch leaves HR unsure what saved, and
   * this is payroll's input.
   *
   * Declared before any `:id`-shaped POST route so `bulk` is never read as an
   * id.
   */
  @Post('bulk')
  @ResponseMessage('Attendance saved successfully!')
  bulkOverride(
    @Body() dto: BulkOverrideAttendanceDto,
    @CurrentUser() user: Express.User,
  ) {
    return this.overrideService.bulkOverride(dto, user.sub);
  }

  /**
   * Correct one already-decided day.
   *
   * Update-only: the id is proof a row exists. A day nobody has marked yet has
   * no id to address, so it goes through the bulk endpoint, which takes the
   * employee and date that would create it.
   */
  @Patch(':id')
  @ResponseMessage('Attendance updated successfully!')
  override(
    @Param('id') id: string,
    @Body() dto: OverrideAttendanceDto,
    @CurrentUser() user: Express.User,
  ) {
    return this.overrideService.override(id, dto, user.sub);
  }

  /**
   * Who changed this day, when, from what, and why.
   *
   * `markedById` on the row answers only who touched it last, which is the
   * wrong question three months later when payroll is disputed.
   */
  @Get(':id/audit')
  @ResponseMessage('Audit history fetched successfully!')
  findAudit(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.auditService.findForAttendance(id, query);
  }
}
