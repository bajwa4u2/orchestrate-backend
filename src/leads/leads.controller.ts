import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { QueueLeadSendDto } from '../execution/dto/queue-lead-send.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateLeadDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.leadsService.create({
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query() query: ListLeadsDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.leadsService.list({
      ...query,
      organizationId: context.organizationId!,
    });
  }

  @Post(':leadId/test-send')
  async testSend(@Headers() headers: Record<string, unknown>, @Param('leadId') leadId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.leadsService.launchTestSend(leadId, context.organizationId!);
  }

  @Post(':leadId/queue-first-send')
  async queueFirstSend(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
    @Body() dto: QueueLeadSendDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.leadsService.queueFirstSend(leadId, {
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Post(':leadId/queue-follow-up')
  async queueFollowUp(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
    @Body() dto: QueueLeadSendDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.leadsService.queueFollowUp(leadId, {
      ...dto,
      organizationId: context.organizationId!,
    });
  }
}
