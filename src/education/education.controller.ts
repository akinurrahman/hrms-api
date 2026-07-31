import { Body, Controller, Param, Put } from '@nestjs/common';
import { EducationService } from './education.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { UpsertEducationDto } from './dto/upsert-education.dto.js';

@Controller('employees/:employeeId/educations')
export class EducationController {
  constructor(private readonly educationService: EducationService) {}

  @Put()
  @Roles(Role.SITE_ADMIN)
  upsert(
    @Param('employeeId') employeeId: string,
    @Body() dto: UpsertEducationDto,
  ) {
    return this.educationService.upsert(employeeId, dto);
  }
}
