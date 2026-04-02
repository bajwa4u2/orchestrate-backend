import { ClientStatus } from '@prisma/client';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

const clientStatuses = ['LEAD', 'ACTIVE', 'PAUSED', 'CHURNED', 'ARCHIVED'] satisfies ClientStatus[];

export class CreateClientDto {
  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsString()
  @Length(2, 150)
  legalName!: string;

  @IsString()
  @Length(2, 150)
  displayName!: string;

  @IsOptional()
  @IsIn(clientStatuses)
  status?: ClientStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  bookingUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryTimezone?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @IsString()
  outboundOffer?: string;

  @IsOptional()
  @IsString()
  notesText?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
