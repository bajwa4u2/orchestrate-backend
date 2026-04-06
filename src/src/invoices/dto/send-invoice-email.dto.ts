import { IsBoolean, IsEmail, IsOptional } from 'class-validator';

export class SendInvoiceEmailDto {
  @IsOptional()
  @IsEmail()
  toEmail?: string;

  @IsOptional()
  @IsBoolean()
  attachPdf?: boolean;
}
