import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReplyToInquiryDto {
  @IsString()
  @MaxLength(10000)
  content!: string;

  @IsOptional()
  sendEmail?: boolean;
}
