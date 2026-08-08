import { Body, Controller, Post } from '@nestjs/common';
import { AttendanceService } from './attendance.service.js';
import { MarkAttendanceDto } from './dto/mark-attendance.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post()
  @Roles(Role.SITE_ADMIN)
  @ResponseMessage('Attendance marked successfully!')
  markAttendance(
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.attendanceService.markAttendance(dto, user.userId);
  }
}
