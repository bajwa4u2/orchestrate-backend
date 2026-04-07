import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateClientSetupDto {
  @IsString()
  @Length(2, 2)
  countryCode!: string;

  @IsString()
  @Length(2, 140)
  countryName!: string;

  @IsString()
  @Length(2, 40)
  regionType!: string;

  @IsString()
  @Length(2, 40)
  regionCode!: string;

  @IsString()
  @Length(2, 140)
  regionName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  localityName?: string;

  @IsString()
  @Length(2, 80)
  industryCode!: string;

  @IsString()
  @Length(2, 120)
  @MaxLength(120)
  industryLabel!: string;

  @IsString()
  @Length(2, 40)
  selectedPlan!: string;
}
