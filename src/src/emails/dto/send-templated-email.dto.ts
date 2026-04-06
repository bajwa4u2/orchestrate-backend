import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @IsOptional()
  @IsIn(['support', 'billing', 'legal', 'hello', 'no-reply'])
  emailCategory?: 'support' | 'billing' | 'legal' | 'hello' | 'no-reply';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  emailEvent?: string;

  @IsOptional()
  @IsEmail()
  replyToEmail?: string;
}
