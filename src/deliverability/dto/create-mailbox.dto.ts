import { MailboxHealthStatus, MailboxProvider, MailboxStatus, WarmupStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const providers = ['GOOGLE', 'MICROSOFT', 'SMTP', 'IMAP_SMTP', 'OTHER'] satisfies MailboxProvider[];
const mailboxStatuses = ['CONNECTING', 'ACTIVE', 'WARMING', 'PAUSED', 'ERROR', 'DISCONNECTED'] satisfies MailboxStatus[];
const warmupStatuses = ['NOT_STARTED', 'RUNNING', 'PAUSED', 'COMPLETED'] satisfies WarmupStatus[];
const healthStatuses = ['HEALTHY', 'WATCH', 'DEGRADED', 'CRITICAL'] satisfies MailboxHealthStatus[];

export class CreateMailboxDto {
  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  domainId?: string;

  @IsString()
  @MaxLength(120)
  label!: string;

  @IsEmail()
  emailAddress!: string;

  @IsIn(providers)
  provider!: MailboxProvider;

  @IsOptional()
  @IsIn(mailboxStatuses)
  status?: MailboxStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dailySendCap?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hourlySendCap?: number;

  @IsOptional()
  @IsIn(warmupStatuses)
  warmupStatus?: WarmupStatus;

  @IsOptional()
  @IsIn(healthStatuses)
  healthStatus?: MailboxHealthStatus;

  @IsOptional()
  @IsObject()
  credentialsJson?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
