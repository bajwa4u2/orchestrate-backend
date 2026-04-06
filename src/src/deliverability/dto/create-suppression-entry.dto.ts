import { SuppressionType } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

const suppressionTypes = ['UNSUBSCRIBE', 'HARD_BOUNCE', 'COMPLAINT', 'MANUAL_BLOCK'] satisfies SuppressionType[];

export class CreateSuppressionEntryDto {
  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsEmail()
  emailAddress?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsIn(suppressionTypes)
  type!: SuppressionType;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
