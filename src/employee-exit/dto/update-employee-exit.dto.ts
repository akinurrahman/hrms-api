import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeExitDto } from './create-employee-exit.dto.js';

/**
 * Documents are managed through their own endpoints, not folded into the
 * amendment payload — a PATCH carrying a `documents` array is ambiguous
 * between "replace the list" and "append to it".
 */
export class UpdateEmployeeExitDto extends PartialType(
  OmitType(CreateEmployeeExitDto, ['documents'] as const),
) {}
