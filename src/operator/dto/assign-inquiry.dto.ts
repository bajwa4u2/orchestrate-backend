import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class AssignInquiryDto {
  @IsOptional()
  @Transform(({ value }) => {
    const text = value == null ? '' : String(value).trim();
    return text.length ? text : undefined;
  })
  @IsString()
  assignedToUserId?: string;
}
