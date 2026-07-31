import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service.js';
import { CertificateController } from './certificate.controller.js';

@Module({
  controllers: [CertificateController],
  providers: [CertificateService],
})
export class CertificateModule {}
