import { IsBoolean, IsOptional } from 'class-validator';

export class RunJobDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
