import { Controller, Body, Param, Put } from '@nestjs/common';
import { FamilyInfoService } from './family-info.service.js';
import { UpsertFamilyInfoDto } from './dto/upsert-family-info.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('employees/:employeeId/family-info')
export class FamilyInfoController {
  constructor(private readonly familyInfoService: FamilyInfoService) {}

  @Put()
  @Roles(Role.SITE_ADMIN)
  upsert(@Param('employeeId') id: string, @Body() dto: UpsertFamilyInfoDto) {
    return this.familyInfoService.upsert(id, dto);
  }
}
