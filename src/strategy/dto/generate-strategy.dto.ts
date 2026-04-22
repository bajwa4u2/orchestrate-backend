import { IsOptional, IsString } from 'class-validator';

export class GenerateStrategyDto {
  @IsOptional()
  @IsString()
  opportunityType?: string;
}
