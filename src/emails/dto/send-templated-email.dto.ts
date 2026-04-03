import { IsBoolean, IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendTemplatedEmailDto {
  @IsString()
  templateId!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsEmail()
  toEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  toName?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  createNotification?: boolean;
}
