import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SetupCountryDto {
  @IsString()
  @MaxLength(2)
  code!: string;

  @IsString()
  @MaxLength(140)
  label!: string;
}

class SetupRegionDto {
  @IsString()
  @MaxLength(2)
  countryCode!: string;

  @IsString()
  @MaxLength(140)
  countryLabel!: string;

  @IsString()
  @MaxLength(40)
  regionType!: string;

  @IsString()
  @MaxLength(40)
  regionCode!: string;

  @IsString()
  @MaxLength(140)
  regionLabel!: string;
}

class SetupMetroDto {
  @IsString()
  @MaxLength(2)
  countryCode!: string;

  @IsString()
  @MaxLength(40)
  regionCode!: string;

  @IsString()
  @MaxLength(140)
  label!: string;
}

class SetupIndustryDto {
  @IsString()
  @MaxLength(80)
  code!: string;

  @IsString()
  @MaxLength(120)
  label!: string;
}

export class CreateClientSetupDto {
  @IsString()
  @IsIn(['opportunity', 'revenue'])
  serviceType!: 'opportunity' | 'revenue';

  @IsString()
  @IsIn(['focused', 'multi', 'precision'])
  scopeMode!: 'focused' | 'multi' | 'precision';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => SetupCountryDto)
  countries!: SetupCountryDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => SetupRegionDto)
  regions!: SetupRegionDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => SetupMetroDto)
  metros?: SetupMetroDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => SetupIndustryDto)
  industries!: SetupIndustryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  includeGeo?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  excludeGeo?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  priorityMarkets?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @IsIn(['focused', 'multi', 'precision'])
  selectedTier?: 'focused' | 'multi' | 'precision';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  selectedPlan?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
