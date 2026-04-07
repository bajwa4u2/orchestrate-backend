import { IsHexColor, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class UpdateClientProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 150)
  legalName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  bookingUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryTimezone?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brandName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  welcomeHeadline?: string;
}
