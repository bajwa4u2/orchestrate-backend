import { AlertSeverity } from '@prisma/client';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const severities = ['INFO', 'WARNING', 'CRITICAL'] satisfies AlertSeverity[];

export class CreateAlertDto {
  @IsIn(severities)
  severity!: AlertSeverity;

  @IsString()
  @MaxLength(120)
  category!: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
