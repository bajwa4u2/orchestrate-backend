import { StatementStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';

const statuses = ['DRAFT', 'ISSUED', 'CLOSED'] satisfies StatementStatus[];

export class CreateStatementDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  statementNumber?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @Type(() => Date)
  @IsDate()
  periodStart!: Date;

  @Type(() => Date)
  @IsDate()
  periodEnd!: Date;

  @IsOptional()
  @IsIn(statuses)
  status?: StatementStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issuedAt?: Date;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
