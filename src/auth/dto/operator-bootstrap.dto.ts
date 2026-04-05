import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class OperatorBootstrapDto {
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(2, 150)
  workspaceName?: string;
}
