import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation.js';
import { DesignationModule } from './designation/designation.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { EmployeeModule } from './employee/employee.module.js';
import { UserModule } from './user/user.module.js';
import { FamilyInfoModule } from './family-info/family-info.module.js';
import { GovtIdsModule } from './govt-ids/govt-ids.module.js';
import { BankDetailsModule } from './bank-details/bank-details.module.js';
import { EmploymentHistoryModule } from './employment-history/employment-history.module.js';
import { EducationModule } from './education/education.module.js';
import { CertificateModule } from './certificate/certificate.module.js';
import { AssetModule } from './asset/asset.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    DesignationModule,
    EmployeeModule,
    UserModule,
    FamilyInfoModule,
    GovtIdsModule,
    BankDetailsModule,
    EmploymentHistoryModule,
    EducationModule,
    CertificateModule,
    AssetModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
