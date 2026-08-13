import { IsString, IsNumber, MinLength } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @IsNumber()
  JWT_ACCESS_EXPIRY!: number;

  @IsNumber()
  JWT_REFRESH_EXPIRY!: number;

  /**
   * Shared secret biometric devices present on `POST /attendance/punches`.
   *
   * Validated here so the app refuses to boot without it. Left optional, a
   * missing value would make the guard compare `undefined` to `undefined` and
   * wave through an unauthenticated write to a payroll input.
   */
  @IsString()
  @MinLength(32)
  DEVICE_API_KEY!: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated);

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validated;
}
