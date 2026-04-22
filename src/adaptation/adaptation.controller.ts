import { Controller, Headers, Param, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AdaptationService } from './adaptation.service';

@Controller('adaptation')
export class AdaptationController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly adaptationService: AdaptationService,
  ) {}

  @Post('campaigns/:campaignId/run')
  async run(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.adaptationService.runForCampaign({ campaignId, organizationId: context.organizationId! });
  }
}
