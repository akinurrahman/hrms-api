import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { EnvironmentVariables } from '../../config/env.validation.js';

const HEADER = 'x-api-key';

/**
 * Authenticates a biometric device by shared secret.
 *
 * Devices cannot hold a JWT — there is nobody to log them in and no refresh
 * cycle to run — so `POST /attendance/punches` is marked `@Public()` to let the
 * global `JwtAuthGuard` fall through, and this guard is what actually stands in
 * front of it. The `@Public()` is not a hole; without the route-level guard it
 * would be.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.header(HEADER);

    if (!presented || !this.matches(presented)) {
      // Deliberately says nothing about which part was wrong, and never
      // reflects the expected value.
      throw new UnauthorizedException('Invalid device credentials');
    }

    return true;
  }

  private matches(presented: string): boolean {
    const expected = Buffer.from(
      this.config.get('DEVICE_API_KEY', { infer: true }),
    );
    const candidate = Buffer.from(presented);

    // `timingSafeEqual` throws on a length mismatch, so length is compared
    // first. That leaks the key's length and nothing else, which is the same
    // thing `MinLength(32)` already publishes.
    return (
      expected.length === candidate.length && timingSafeEqual(expected, candidate)
    );
  }
}
