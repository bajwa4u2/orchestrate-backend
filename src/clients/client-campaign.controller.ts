import { Body, Controller, Get, Headers, Patch } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { UpdateCampaignProfileDto } from './dto/update-campaign-profile.dto';

@Controller('client/campaign-profile')
export class ClientCampaignController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  getCampaignProfile(@Headers() headers: Record<string, unknown>) {
    return this.clientsService.getCampaignProfile(headers);
  }

  @Patch()
  updateCampaignProfile(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: UpdateCampaignProfileDto,
  ) {
    return this.clientsService.updateCampaignProfile(headers, dto);
  }
}
