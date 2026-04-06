import { IsEnum } from 'class-validator';

export enum PublicInquiryStatusDto {
  NEW = 'NEW',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  IN_PROGRESS = 'IN_PROGRESS',
  CLOSED = 'CLOSED',
  SPAM = 'SPAM',
}

export class UpdateInquiryStatusDto {
  @IsEnum(PublicInquiryStatusDto)
  status!: PublicInquiryStatusDto;
}
