import { PolicyScope } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

const scopes = ['GLOBAL', 'ORGANIZATION', 'CLIENT', 'CAMPAIGN', 'MAILBOX'] satisfies PolicyScope[];

export class CreateSendPolicyDto {
  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsIn(scopes)
  scope!: PolicyScope;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dailyCap?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hourlyCap?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minDelaySeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxDelaySeconds?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  allowedWeekdays?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  activeFromHour?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  activeToHour?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  configJson?: Record<string, unknown>;
}
