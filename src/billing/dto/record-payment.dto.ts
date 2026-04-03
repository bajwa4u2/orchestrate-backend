import { PaymentMethodType, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';

const methods = ['MANUAL', 'STRIPE', 'ACH', 'CARD', 'WIRE', 'CASH', 'OTHER'] satisfies PaymentMethodType[];
const statuses = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] satisfies PaymentStatus[];

export class RecordPaymentDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsIn(methods)
  method!: PaymentMethodType;

  @IsOptional()
  @IsIn(statuses)
  status?: PaymentStatus;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @IsString()
  externalRef?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  receivedAt?: Date;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
