import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInquiryReplyDto {
  @Transform(({ value, obj }) => value ?? obj?.content)
  @IsString()
  @MinLength(2)
  @MaxLength(12000)
  bodyText!: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
