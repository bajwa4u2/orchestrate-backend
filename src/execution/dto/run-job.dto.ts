import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RunJobDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  organizationId?: string;
}
