import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInquiryNoteDto {
  @Transform(({ value, obj }) => value ?? obj?.content)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  bodyText!: string;
}
