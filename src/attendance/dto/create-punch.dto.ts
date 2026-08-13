import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PunchDirection } from '../../generated/prisma/enums.js';

export class PunchItemDto {
  /**
   * `Employee.employeeId` — the business code printed on the badge, not our
   * UUID. No biometric device has ever heard of a UUID.
   */
  @IsString()
  @IsNotEmpty()
  employeeCode!: string;

  /**
   * Full timestamp with an offset, e.g. `2026-08-13T03:45:00Z`. Validated as
   * a string and converted in the service — a bare `2026-08-13` would parse
   * to midnight UTC and quietly claim a punch happened at 05:30 IST.
   */
  @IsISO8601({ strict: true })
  punchedAt!: string;

  /** Omit it. Devices rarely know, and derivation works it out from the set. */
  @IsOptional()
  @IsEnum(PunchDirection)
  direction?: PunchDirection;

  /**
   * Part of the dedupe key. Left off, it stores as the `UNKNOWN` sentinel —
   * which still dedupes, unlike a NULL.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId?: string;

  /** Whatever else the device sent, kept verbatim for later forensics. */
  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}

export class CreatePunchBatchDto {
  /**
   * `@ValidateNested({ each: true })` and `@Type()` are both required. With
   * only one of them the array's items are never validated and malformed
   * punches reach the service as plain objects.
   *
   * Capped at 500: a device replaying a week of downtime should page rather
   * than send one enormous body.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PunchItemDto)
  punches!: PunchItemDto[];
}
