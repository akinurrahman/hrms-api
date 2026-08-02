import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsBoolean()
  @IsOptional()
  pinned?: boolean;
}
