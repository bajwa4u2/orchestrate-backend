import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePublicIntakeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(190)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourcePage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  inquiryTypeHint?: string;
}
