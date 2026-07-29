import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertGovtIdDto {
  @IsString()
  @IsNotEmpty()
  aadharNo!: string;

  @IsString()
  @IsNotEmpty()
  panNo!: string;

  @IsString()
  @IsOptional()
  uanNo?: string;

  @IsString()
  @IsOptional()
  esicNo?: string;
}
