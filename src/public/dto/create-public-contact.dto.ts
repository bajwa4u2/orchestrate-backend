import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum PublicInquiryTypeDto {
  SERVICE_FIT = 'SERVICE_FIT',
  PRICING = 'PRICING',
  BILLING_SUPPORT = 'BILLING_SUPPORT',
  ONBOARDING = 'ONBOARDING',
  PARTNERSHIP = 'PARTNERSHIP',
  GENERAL_INQUIRY = 'GENERAL_INQUIRY',
}

export class CreatePublicContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @IsEnum(PublicInquiryTypeDto)
  inquiryType!: PublicInquiryTypeDto;

  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  message!: string;
}
