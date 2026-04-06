import { ReplyIntent } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEmail, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const replyIntents = ['INTERESTED', 'NOT_NOW', 'NOT_RELEVANT', 'REFERRAL', 'UNSUBSCRIBE', 'OOO', 'BOUNCE', 'UNCLEAR', 'HUMAN_REVIEW'] satisfies ReplyIntent[];

export class IntakeReplyDto {
  @IsString()
  organizationId!: string;

  @IsString()
  clientId!: string;

  @IsString()
  leadId!: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  messageId?: string;

  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsOptional()
  @IsIn(replyIntents)
  intent?: ReplyIntent;

  @IsOptional()
  @IsEmail()
  fromEmail?: string;

  @IsOptional()
  @IsString()
  subjectLine?: string;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  receivedAt?: Date;

  @IsOptional()
  @IsBoolean()
  booked?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
