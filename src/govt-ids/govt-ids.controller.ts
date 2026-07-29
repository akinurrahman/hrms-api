import { Body, Controller, Param, Put } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { GovtIdsService } from './govt-ids.service.js';
import { UpsertGovtIdDto } from './dto/upsert-govt-id.dto.js';

@Controller('/employees/:employeeId/govt-ids')
export class GovtIdsController {
  constructor(private readonly govtIdsService: GovtIdsService) {}

  @Put()
  @Roles(Role.SITE_ADMIN)
  upsert(@Param('employeeId') id: string, @Body() dto: UpsertGovtIdDto) {
    return this.govtIdsService.upsert(id, dto);
  }
}
