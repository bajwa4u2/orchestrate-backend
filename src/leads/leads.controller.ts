import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { QueueLeadSendDto } from '../execution/dto/queue-lead-send.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly accessContextService: AccessContextService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateLeadDto) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'leads.write',
    );

    return this.leadsService.create({
      ...dto,
      organizationId: context.organizationId!,
      clientId: context.clientId!,
    });
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query() query: ListLeadsDto) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'leads.read',
    );

    return this.leadsService.list({
      ...query,
      organizationId: context.organizationId!,
      clientId: context.clientId!,
    });
  }

  @Post(':leadId/test-send')
  async testSend(@Headers() headers: Record<string, unknown>, @Param('leadId') leadId: string) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'execution.queue',
    );
    await this.leadsService.assertLeadAccessible(context.organizationId!, context.clientId!, leadId);
    return this.leadsService.launchTestSend(leadId);
  }

  @Post(':leadId/queue-first-send')
  async queueFirstSend(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
    @Body() dto: QueueLeadSendDto,
  ) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'execution.queue',
    );
    await this.leadsService.assertLeadAccessible(context.organizationId!, context.clientId!, leadId);
    return this.leadsService.queueFirstSend(leadId, dto);
  }

  @Post(':leadId/queue-follow-up')
  async queueFollowUp(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
    @Body() dto: QueueLeadSendDto,
  ) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'execution.queue',
    );
    await this.leadsService.assertLeadAccessible(context.organizationId!, context.clientId!, leadId);
    return this.leadsService.queueFollowUp(leadId, dto);
  }
}
