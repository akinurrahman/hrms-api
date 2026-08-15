import { Controller, Get } from '@nestjs/common';
import { LeaveTypeService } from './leave-type.service.js';
import { ResponseMessage } from '../common/index.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

/**
 * Readable by employees as well as admins: anyone filing or reviewing leave has
 * to see what the codes mean.
 */
@Roles(Role.SITE_ADMIN, Role.EMPLOYEE)
@Controller('leave-types')
export class LeaveTypeController {
  constructor(private readonly leaveTypeService: LeaveTypeService) {}

  @Get()
  @ResponseMessage('Leave types fetched successfully!')
  findAll() {
    return this.leaveTypeService.findAll();
  }
}
