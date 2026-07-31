import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CertificateItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  certificateName!: string;

  @IsString()
  @IsNotEmpty()
  issuingOrg!: string;

  @IsOptional()
  @IsString()
  topicDescription?: string;

  @IsOptional()
  @IsString()
  certificateUrl?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
