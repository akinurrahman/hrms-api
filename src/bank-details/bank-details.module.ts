import { Module } from '@nestjs/common';
import { BankDetailsService } from './bank-details.service.js';
import { BankDetailsController } from './bank-details.controller.js';

@Module({
  controllers: [BankDetailsController],
  providers: [BankDetailsService],
})
export class BankDetailsModule {}
