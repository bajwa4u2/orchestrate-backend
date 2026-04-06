import { IsOptional, IsString } from 'class-validator';

export class AssignInquiryDto {
  @IsOptional()
  @IsString()
  assignedToUserId?: string;
}
