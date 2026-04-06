import { TemplateType } from '@prisma/client';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const templateTypes = ['OUTREACH', 'FOLLOW_UP', 'REPLY', 'INTERNAL', 'WELCOME', 'SUBSCRIPTION', 'INVOICE', 'RECEIPT', 'AGREEMENT', 'STATEMENT', 'REMINDER'] satisfies TemplateType[];

export class CreateTemplateDto {
  @IsIn(templateTypes)
  type!: TemplateType;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  bodyTemplate?: string;

  @IsOptional()
  @IsObject()
  variablesJson?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
