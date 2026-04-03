import { ReminderArtifactKind, ReminderArtifactStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const kinds = ['PAYMENT_DUE', 'PAYMENT_OVERDUE', 'STATEMENT_READY', 'AGREEMENT_SIGNATURE', 'SERVICE_FOLLOW_UP'] satisfies ReminderArtifactKind[];
const statuses = ['PENDING', 'SENT', 'ACKNOWLEDGED', 'CANCELED'] satisfies ReminderArtifactStatus[];

export class CreateReminderDto {
  @IsString()
  clientId!: string;

  @IsIn(kinds)
  kind!: ReminderArtifactKind;

  @IsOptional()
  @IsIn(statuses)
  status?: ReminderArtifactStatus;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  agreementId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @IsOptional()
  @IsString()
  subjectLine?: string;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
