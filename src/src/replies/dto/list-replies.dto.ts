import { ReplyIntent } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const replyIntents = ['INTERESTED', 'NOT_NOW', 'NOT_RELEVANT', 'REFERRAL', 'UNSUBSCRIBE', 'OOO', 'BOUNCE', 'UNCLEAR', 'HUMAN_REVIEW'] satisfies ReplyIntent[];

export class ListRepliesDto extends PaginationQueryDto {
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
  @IsIn(replyIntents)
  intent?: ReplyIntent;
}
