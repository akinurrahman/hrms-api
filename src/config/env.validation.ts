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
