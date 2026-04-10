import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeactivateClientAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  confirmationText?: string;
}
