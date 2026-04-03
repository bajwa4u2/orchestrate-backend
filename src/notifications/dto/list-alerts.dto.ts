import { AlertStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';

const statuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'MUTED'] satisfies AlertStatus[];

export class ListAlertsDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsIn(statuses)
  status?: AlertStatus;
}
