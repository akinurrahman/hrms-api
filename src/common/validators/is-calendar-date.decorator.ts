import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { toUtcDateOnly } from '../utils/date.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date, `YYYY-MM-DD`, that actually exists.
 *
 * Stricter than `@IsDateString()` on two counts, both of which have already
 * cost a bug:
 *
 * 1. `@IsDateString()` accepts a full timestamp, so an offset-bearing string
 *    like `2026-09-01T01:00:00+05:30` lands on 2026-08-31 in a `@db.Date`
 *    column — a silently wrong day.
 * 2. `@IsDateString()` does not range-check the day, so `2026-02-30` passes
 *    validation and then throws `RangeError` inside `toUtcDateOnly()`. That
 *    escapes `HttpExceptionFilter` (which only catches `HttpException`) and
 *    surfaces as a 500 instead of a 400.
 *
 * Rejecting both at the DTO boundary keeps `toUtcDateOnly()` free to throw,
 * which is the right behaviour for a pure helper called from anywhere.
 */
export function IsCalendarDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
            return false;
          }

          try {
            toUtcDateOnly(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a real calendar date in YYYY-MM-DD format`;
        },
      },
    });
  };
}
