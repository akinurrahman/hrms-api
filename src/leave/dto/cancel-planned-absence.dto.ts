import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelPlannedAbsenceDto {
  /**
   * Required. Cancellation is the operation most likely to be questioned later —
   * somebody's leave record changed after the fact — and "why" is the only part
   * of it that cannot be reconstructed from the row.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  cancelReason!: string;
}
