import { Body, Controller, Param, Put } from '@nestjs/common';
import { CertificateService } from './certificate.service.js';
import { UpsertCertificateDto } from './dto/upsert-certificate.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('employees/:employeeId/certificates')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Put()
  @Roles(Role.SITE_ADMIN)
  upsert(
    @Param('employeeId') employeeId: string,
    @Body() dto: UpsertCertificateDto,
  ) {
    return this.certificateService.upsert(employeeId, dto);
  }
}
