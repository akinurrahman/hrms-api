import { Controller, Body, Param, Put } from '@nestjs/common';
import { BankDetailsService } from './bank-details.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';
import { UpsertBankDetailsDto } from './dto/upsert-bank-detail.dto.js';

@Controller('/employees/:employeeId/bank-details')
export class BankDetailsController {
  constructor(private readonly bankDetailsService: BankDetailsService) {}

  @Put()
  @Roles(Role.SITE_ADMIN)
  upsert(
    @Param('employeeId') employeeId: string,
    @Body() dto: UpsertBankDetailsDto,
  ) {
    return this.bankDetailsService.upsert(employeeId, dto);
  }
}
