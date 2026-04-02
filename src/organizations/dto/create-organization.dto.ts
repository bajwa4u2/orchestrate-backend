import { OrganizationType } from '@prisma/client';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const organizationTypes = ['PLATFORM', 'INTERNAL', 'CLIENT_ACCOUNT'] satisfies OrganizationType[];

export class CreateOrganizationDto {
  @IsString()
  @Length(2, 80)
  slug!: string;

  @IsString()
  @Length(2, 150)
  legalName!: string;

  @IsString()
  @Length(2, 150)
  displayName!: string;

  @IsOptional()
  @IsIn(organizationTypes)
  type?: OrganizationType;

  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
