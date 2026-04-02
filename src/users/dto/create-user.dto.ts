import { IsEmail, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @Length(8, 255)
  passwordHash?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
