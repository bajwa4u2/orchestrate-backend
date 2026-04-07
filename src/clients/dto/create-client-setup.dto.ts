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
  @MaxLength(120)
  industry!: string;

  @IsArray()
  @IsString({ each: true })
  scope!: string[];

  @IsOptional()
  @IsString()
  selectedPlan?: string;
}
