import { AgreementStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const statuses = ['DRAFT', 'ISSUED', 'ACCEPTED', 'ACTIVE', 'EXPIRED', 'TERMINATED'] satisfies AgreementStatus[];

export class CreateServiceAgreementDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  agreementNumber?: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsIn(statuses)
  status?: AgreementStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveStartAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveEndAt?: Date;

  @IsOptional()
  @IsString()
  termsText?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
