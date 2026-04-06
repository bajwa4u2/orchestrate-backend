import { IsString, MaxLength } from 'class-validator';

export class CreateInquiryNoteDto {
  @IsString()
  @MaxLength(5000)
  content!: string;
}
