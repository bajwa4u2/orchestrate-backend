import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReplyIntakeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}
