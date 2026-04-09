import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateClientIntakeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}
