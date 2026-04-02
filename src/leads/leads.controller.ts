import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { QueueLeadSendDto } from '../execution/dto/queue-lead-send.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }

  @Get()
  list(@Query() query: ListLeadsDto) {
    return this.leadsService.list(query);
  }

  @Post(':leadId/test-send')
  testSend(@Param('leadId') leadId: string) {
    return this.leadsService.launchTestSend(leadId);
  }

  @Post(':leadId/queue-first-send')
  queueFirstSend(@Param('leadId') leadId: string, @Body() dto: QueueLeadSendDto) {
    return this.leadsService.queueFirstSend(leadId, dto);
  }

  @Post(':leadId/queue-follow-up')
  queueFollowUp(@Param('leadId') leadId: string, @Body() dto: QueueLeadSendDto) {
    return this.leadsService.queueFollowUp(leadId, dto);
  }
}
