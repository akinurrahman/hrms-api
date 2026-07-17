import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { DesignationCategory } from '../../generated/prisma/client.js';

export class CreateDesignationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsEnum(DesignationCategory)
  category!: DesignationCategory;
}
