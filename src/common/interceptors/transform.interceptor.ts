import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface PaginatedResult<T> {
  data: T[];
  pagination: Record<string, unknown>;
  /**
   * `buildPaginatedResponse`'s optional extra, for a page that has something to
   * say about the whole set rather than about its rows — the monthly sheet's
   * cycle, for instance. Forwarded only when present, so nothing that does not
   * supply it changes shape.
   */
  stats?: Record<string, unknown>;
}

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'pagination' in value
  );
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const message =
      this.reflector.get<string>('response_message', context.getHandler()) ??
      'Success';

    return next.handle().pipe(
      map((result: unknown) => {
        if (isPaginatedResult(result)) {
          return {
            success: true,
            message,
            data: result.data,
            pagination: result.pagination,
            ...(result.stats !== undefined && { stats: result.stats }),
          };
        }

        return {
          success: true,
          message,
          data: result,
        };
      }),
    );
  }
}
