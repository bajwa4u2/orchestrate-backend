import { Controller, Get, Headers, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { ListMeetingsDto } from './dto/list-meetings.dto';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, string>, @Query() query: ListMeetingsDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.meetingsService.list({
      ...query,
      organizationId: context.organizationId,
    });
  }
}
