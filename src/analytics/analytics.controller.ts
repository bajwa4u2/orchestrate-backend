import { Controller, Get, Headers, Param } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Get('campaigns/:campaignId/source-yield')
  async sourceYield(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.analyticsService.sourceYield(campaignId, context.organizationId!);
  }

  @Get('campaigns/:campaignId/conversion')
  async conversion(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.analyticsService.conversion(campaignId, context.organizationId!);
  }
}
