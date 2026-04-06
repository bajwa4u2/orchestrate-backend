import { LeadSourceType, LeadStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const leadStatuses = ['NEW', 'ENRICHED', 'QUALIFIED', 'CONTACTED', 'FOLLOWED_UP', 'REPLIED', 'INTERESTED', 'BOOKED', 'CLOSED_LOST', 'SUPPRESSED'] satisfies LeadStatus[];
const leadSourceTypes = ['MANUAL', 'CSV_IMPORT', 'GOOGLE_MAPS', 'DIRECTORY', 'API', 'INTERNAL_GROWTH', 'REFERRAL', 'OTHER'] satisfies LeadSourceType[];

export class CreateLeadDto {
  @IsString()
  organizationId!: string;

  @IsString()
  clientId!: string;

  @IsString()
  campaignId!: string;

  @IsOptional()
  @IsIn(leadStatuses)
  status?: LeadStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  leadSourceId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  domain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeCount?: number;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  linkedinUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  sourceName?: string;

  @IsOptional()
  @IsIn(leadSourceTypes)
  sourceType?: LeadSourceType;

  @IsOptional()
  @IsString()
  sourceRef?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
