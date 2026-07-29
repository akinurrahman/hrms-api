import { IsEnum, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import {
  EmergencyContactRelation,
  MaritalStatus,
} from '../../generated/prisma/enums.js';

export class UpsertFamilyInfoDto {
  @IsString()
  @IsNotEmpty()
  fathersName!: string;

  @IsString()
  @IsNotEmpty()
  mothersName!: string;

  @IsEnum(MaritalStatus)
  maritalStatus!: MaritalStatus;

  @ValidateIf(
    (dto: UpsertFamilyInfoDto) => dto.maritalStatus === MaritalStatus.MARRIED,
  )
  @IsString()
  @IsNotEmpty()
  spouseName?: string;

  @IsString()
  @IsNotEmpty()
  emergencyContactName!: string;

  @IsString()
  @IsNotEmpty()
  emergencyContactNumber!: string;

  @IsEnum(EmergencyContactRelation)
  emergencyContactRelation!: EmergencyContactRelation;

  @IsString()
  @IsNotEmpty()
  emergencyContactAddress!: string;
}
