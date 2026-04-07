import { IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateClientSetupDto {
  @IsString()
  @Length(2, 100)
  country!: string;

  @IsString()
  @Length(2, 120)
  area!: string;

  @IsString()
  @Length(2, 120)
  industry!: string;

  @IsArray()
  scope!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  selectedPlan?: string;
}
