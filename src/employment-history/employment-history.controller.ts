import { Body, Controller, Param, Put } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { EmploymentHistoryService } from './employment-history.service.js';
import { UpsertEmploymentHistoryDto } from './dto/upsert-employment-history.dto.js';

@Controller('employees/:employeeId/employment-history')
export class EmploymentHistoryController {
  constructor(
    private readonly employmentHistoryService: EmploymentHistoryService,
  ) {}

  @Put()
  @Roles(Role.SITE_ADMIN)
  upsert(
    @Param('employeeId') employeeId: string,
    @Body() dto: UpsertEmploymentHistoryDto,
  ) {
    return this.employmentHistoryService.upsert(employeeId, dto);
  }
}
