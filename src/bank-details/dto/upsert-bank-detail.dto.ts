import { IsString, IsNotEmpty } from 'class-validator';

export class UpsertBankDetailsDto {
  @IsString()
  @IsNotEmpty()
  accountNo!: string;

  @IsString()
  @IsNotEmpty()
  ifscCode!: string;

  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @IsString()
  @IsNotEmpty()
  branchName!: string;

  @IsString()
  @IsNotEmpty()
  accountHolder!: string;
}
