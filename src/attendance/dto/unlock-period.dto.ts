import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Reopening a locked cycle.
 *
 * The reason is mandatory, and the minimum length is deliberate. "fix" is not a
 * reason — "who reopened August, and why" is the first question asked when the
 * numbers payroll already paid against change, and the answer has to be
 * readable months later by somebody who was not there.
 *
 * In real payroll practice a paid month is not reopened at all; an adjustment is
 * carried into the next cycle. That mechanism belongs to payroll and is out of
 * scope here, which makes this an escape hatch rather than a routine operation.
 */
export class UnlockPeriodDto {
  @IsString()
  @MinLength(10, {
    message:
      'unlockReason must explain why a locked cycle is being reopened — at least 10 characters',
  })
  @MaxLength(500)
  unlockReason!: string;
}
