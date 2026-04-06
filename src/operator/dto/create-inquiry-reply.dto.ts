import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInquiryReplyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(12000)
  bodyText!: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
