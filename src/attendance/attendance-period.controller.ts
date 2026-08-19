import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AttendanceLockService } from './attendance-lock.service.js';
import { AttendancePeriodService } from './attendance-period.service.js';
import { CreateAttendancePeriodDto } from './dto/create-attendance-period.dto.js';
import { FindAttendancePeriodDto } from './dto/find-attendance-period.dto.js';
import { FindSummaryDto } from './dto/find-summary.dto.js';
import { UnlockPeriodDto } from './dto/unlock-period.dto.js';
import { ResponseMessage } from '../common/index.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
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
 * able to notice and no undo. Lock and unlock are the only mutations this entity
 * gets, and both of them record who did it and why.
 *
 * Unlock is `SITE_ADMIN` here rather than the PRD's `SUPER_ADMIN`, which does not
 * exist in the `Role` enum yet. What actually restrains it is the mandatory
 * reason and the audit columns, both of which survive the role being tightened
 * later.
 */
@Roles(Role.SITE_ADMIN)
@Controller('attendance-periods')
export class AttendancePeriodController {
  constructor(
    private readonly periodService: AttendancePeriodService,
    private readonly lockService: AttendanceLockService,
  ) {}

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

  /**
   * Close the cycle: check the month is fit to be paid from, snapshot it, and
   * refuse every further write into it.
   *
   * Refuses with a list rather than a sentence when the month still holds
   * unfinished records — an unresolved conflict, a day nobody ever created, a
   * check-in with no check-out. Locking those does not make them go away; it
   * makes them payroll's problem instead of HR's.
   */
  @Post(':id/lock')
  @ResponseMessage('Attendance period locked successfully!')
  lock(@Param('id') id: string, @CurrentUser() user: Express.User) {
    return this.lockService.lock(id, user.sub);
  }

  /**
   * Reopen a locked cycle. The escape hatch, not the routine path — real payroll
   * carries an adjustment into the next cycle rather than reopening a paid
   * month.
   *
   * Generated summaries are left untouched: they stay current until a relock
   * supersedes them with a new version.
   */
  @Post(':id/unlock')
  @ResponseMessage('Attendance period unlocked successfully!')
  unlock(
    @Param('id') id: string,
    @Body() dto: UnlockPeriodDto,
    @CurrentUser() user: Express.User,
  ) {
    return this.lockService.unlock(id, user.sub, dto);
  }

  /**
   * What locking produced — payroll's input.
   *
   * Current version by default; `?version=` reads a superseded one, which is the
   * only way to see what the numbers said before a month was reopened.
   */
  @Get(':id/summary')
  @ResponseMessage('Attendance summaries fetched successfully!')
  findSummaries(@Param('id') id: string, @Query() query: FindSummaryDto) {
    return this.lockService.findSummaries(id, query);
  }
}
