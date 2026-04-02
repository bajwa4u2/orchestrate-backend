import { JobType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

const sendJobTypes = ['FIRST_SEND', 'FOLLOWUP_SEND'] satisfies JobType[];

export class QueueLeadSendDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsIn(sendJobTypes)
  jobType?: JobType;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledFor?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @IsOptional()
  @IsBoolean()
  simulateDeliveryOnly?: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
