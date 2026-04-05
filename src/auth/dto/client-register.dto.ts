import { IsEmail, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class ClientRegisterDto {
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @Length(2, 150)
  companyName!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  websiteUrl?: string;
}
