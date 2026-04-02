import { DomainStatus } from '@prisma/client';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const domainStatuses = ['PENDING', 'ACTIVE', 'PAUSED', 'BLOCKED'] satisfies DomainStatus[];

export class CreateSendingDomainDto {
  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsString()
  @MaxLength(190)
  domain!: string;

  @IsOptional()
  @IsIn(domainStatuses)
  status?: DomainStatus;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
