import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCampaignProfileDto {
  @IsOptional()
  @IsArray()
  countries?: Array<{ code: string; label: string }>;

  @IsOptional()
  @IsArray()
  regions?: Array<{
    countryCode: string;
    countryLabel: string;
    regionType: string;
    regionCode: string;
    regionLabel: string;
  }>;

  @IsOptional()
  @IsArray()
  metros?: Array<{
    countryCode: string;
    regionCode: string;
    label: string;
  }>;

  @IsOptional()
  @IsArray()
  industries?: Array<{ code: string; label: string }>;

  @IsOptional()
  @IsArray()
  includeGeo?: string[];

  @IsOptional()
  @IsArray()
  excludeGeo?: string[];

  @IsOptional()
  @IsArray()
  priorityMarkets?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
