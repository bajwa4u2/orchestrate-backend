import { CampaignStatus, MessageChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Length, MaxLength, Min } from 'class-validator';

const campaignStatuses = ['DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] satisfies CampaignStatus[];
const channels = ['EMAIL'] satisfies MessageChannel[];

export class CreateCampaignDto {
  @IsString()
  organizationId!: string;

  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  icpId?: string;

  @IsOptional()
  @IsString()
  segmentId?: string;

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsString()
  @Length(2, 150)
  name!: string;

  @IsOptional()
  @IsIn(campaignStatuses)
  status?: CampaignStatus;

  @IsOptional()
  @IsIn(channels)
  channel?: MessageChannel;

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsString()
  offerSummary?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  bookingUrlOverride?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dailySendCap?: number;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endAt?: Date;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
