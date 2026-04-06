import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInquiryNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  bodyText!: string;
}
