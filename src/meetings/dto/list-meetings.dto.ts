import { MeetingStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const meetingStatuses = ['PROPOSED', 'BOOKED', 'COMPLETED', 'CANCELED', 'NO_SHOW'] satisfies MeetingStatus[];

export class ListMeetingsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsIn(meetingStatuses)
  status?: MeetingStatus;
}
