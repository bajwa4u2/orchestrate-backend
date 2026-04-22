import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { SourcePlannerService } from './source-planner.service';

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly sourcePlannerService: SourcePlannerService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('campaigns/:campaignId/plan')
  async plan(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    const sourcePlan = await this.prisma.sourcePlan.findFirst({
      where: { campaignId, organizationId: context.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
    return { sourcePlan };
  }

  @Post('campaigns/:campaignId/discover')
  async discover(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.sourcePlannerService.discoverForCampaign({ campaignId, organizationId: context.organizationId! });
  }

  @Get('campaigns/:campaignId/runs')
  async runs(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    const items = await this.prisma.sourceRun.findMany({
      where: { campaignId, organizationId: context.organizationId! },
      orderBy: { startedAt: 'desc' },
    });
    return { items };
  }
}
