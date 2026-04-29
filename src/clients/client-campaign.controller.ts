import { Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { ClientsService } from './clients.service';
import { UpdateCampaignProfileDto } from './dto/update-campaign-profile.dto';

@Controller('client/campaign-profile')
export class ClientCampaignController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly campaignsService: CampaignsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async getCampaignProfile(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.getCampaignProfile(headers);
  }

  @Get('operational-view')
  async getOperationalView(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    const profile = await this.clientsService.getCampaignProfile(headers) as any;
    const campaignId = profile?.campaign?.id ?? profile?.campaignId ?? null;

    if (!campaignId) {
      return {
        campaign: null,
        execution: {
          state: 'NOT_STARTED',
          summary: 'Campaign has not been started yet.',
        },
      };
    }

    return this.campaignsService.getCampaignOperationalView(
      campaignId,
      context.organizationId!,
      context.clientId!,
    );
  }

  @Patch()
  async updateCampaignProfile(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: UpdateCampaignProfileDto,
  ) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.updateCampaignProfile(headers, dto);
  }

  @Post('start')
  async startCampaign(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.startCampaign(headers);
  }

  @Post('restart')
  async restartCampaign(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.restartCampaign(headers);
  }
}
