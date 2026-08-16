import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PlannedAbsenceService } from './planned-absence.service.js';
import { CancelPlannedAbsenceDto } from './dto/cancel-planned-absence.dto.js';
import { CreatePlannedAbsenceDto } from './dto/create-planned-absence.dto.js';
import { FindPlannedAbsenceDto } from './dto/find-planned-absence.dto.js';
import { ResponseMessage } from '../common/index.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Roles(Role.SITE_ADMIN)
@Controller('planned-absences')
export class PlannedAbsenceController {
  constructor(private readonly absenceService: PlannedAbsenceService) {}

  /**
   * File an approved absence.
   *
   * Also fixes the past: days already closed as ABSENT flip to ON_LEAVE, which
   * is the response's `converted` count. `conflicted` is the days it refused to
   * touch because a punch or a manual mark contradicts the leave.
   *
   * `approvedById` comes from the token, never the body — who approved a leave
   * is not something the caller gets to assert.
   */
  @Post()
  @ResponseMessage('Planned absence recorded successfully!')
  create(
    @Body() dto: CreatePlannedAbsenceDto,
    @CurrentUser() user: Express.User,
  ) {
    return this.absenceService.create(dto, user.sub);
  }

  @Get()
  @ResponseMessage('Planned absences fetched successfully!')
  findAll(@Query() query: FindPlannedAbsenceDto) {
    return this.absenceService.findAll(query);
  }

  @Get(':id')
  @ResponseMessage('Planned absence fetched successfully!')
  findOne(@Param('id') id: string) {
    return this.absenceService.findOne(id);
  }

  /**
   * Withdraw, rather than delete: attendance rows point at this record, and a
   * cancelled leave that somebody has to explain later is exactly the thing the
   * history is for.
   *
   * Also undoes the past. Days this absence flipped to ON_LEAVE go back to
   * ABSENT — or to PRESENT, if the punches say he was there after all — which is
   * the response's `reverted` count. `conflicted` is the days it refused to
   * touch because a punch or a manual mark now owns them.
   */
  @Patch(':id/cancel')
  @ResponseMessage('Planned absence cancelled successfully!')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelPlannedAbsenceDto,
    @CurrentUser() user: Express.User,
  ) {
    return this.absenceService.cancel(id, dto, user.sub);
  }
}
