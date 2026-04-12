import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RepliesService } from './replies.service';

@Controller('replies')
export class RepliesController {
  constructor(private readonly repliesService: RepliesService) {}

  @Post('inbound')
  ingestInbound(
    @Body()
    body: {
      mailboxEmail?: string;
      fromEmail: string;
      subjectLine?: string;
      bodyText?: string;
      externalMessageId?: string;
      threadKey?: string;
      receivedAt?: string;
    },
  ) {
    return this.repliesService.ingestInboundReply(body);
  }

  @Post(':id/process')
  process(@Param('id') id: string) {
    return this.repliesService.processReply(id);
  }

  @Get()
  list(@Query('clientId') clientId: string) {
    return this.repliesService.listForClient(clientId);
  }
}
