import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePublicIntakeDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(190)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  sourcePage?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'pricing',
    'billing',
    'billing_support',
    'support',
    'technical',
    'onboarding',
    'sales',
    'partnership',
    'compliance',
    'service_fit',
    'general',
    'other',
  ])
  @MaxLength(120)
  inquiryTypeHint?: string;
}
