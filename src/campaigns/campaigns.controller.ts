import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly accessContextService: AccessContextService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateCampaignDto) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'campaigns.write',
    );

    return this.campaignsService.create({
      ...dto,
      organizationId: context.organizationId!,
      clientId: context.clientId!,
      createdById: context.userId,
    });
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query() query: ListCampaignsDto) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'campaigns.read',
    );

    return this.campaignsService.list({
      ...query,
      organizationId: context.organizationId!,
      clientId: context.clientId!,
    });
  }
}
