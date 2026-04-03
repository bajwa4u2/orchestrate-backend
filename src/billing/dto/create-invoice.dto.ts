import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateInvoiceLineDto {
  @IsString()
  @MaxLength(200)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  serviceCategory?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitAmountCents!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}

export class CreateInvoiceDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  billingProfileId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  taxCents?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issuedAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueAt?: Date;

  @IsOptional()
  @IsString()
  notesText?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  lines!: CreateInvoiceLineDto[];

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
