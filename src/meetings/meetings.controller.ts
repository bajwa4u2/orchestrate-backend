import { Controller, Get, Query } from '@nestjs/common';
import { ListMeetingsDto } from './dto/list-meetings.dto';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  list(@Query() query: ListMeetingsDto) {
    return this.meetingsService.list(query);
  }
}
