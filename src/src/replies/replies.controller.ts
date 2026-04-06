import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IntakeReplyDto } from './dto/intake-reply.dto';
import { ListRepliesDto } from './dto/list-replies.dto';
import { RepliesService } from './replies.service';

@Controller('replies')
export class RepliesController {
  constructor(private readonly repliesService: RepliesService) {}

  @Post('intake')
  intake(@Body() dto: IntakeReplyDto) {
    return this.repliesService.intake(dto);
  }

  @Get()
  list(@Query() query: ListRepliesDto) {
    return this.repliesService.list(query);
  }
}
