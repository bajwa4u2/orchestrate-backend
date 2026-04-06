import { IsObject, IsOptional, IsString } from 'class-validator';

export class RegisterComplaintDto {
  @IsString()
  complainedEmail!: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
