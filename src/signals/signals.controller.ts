import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { SignalDetectionService } from './signal-detection.service';

@Controller('signals')
export class SignalsController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly detectionService: SignalDetectionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('campaigns/:campaignId/detect')
  async detect(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.detectionService.detectForCampaign({ campaignId, organizationId: context.organizationId! });
  }

  @Get('campaigns/:campaignId')
  async list(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    const items = await this.prisma.signalEvent.findMany({
      where: { campaignId, organizationId: context.organizationId! },
      orderBy: { detectedAt: 'desc' },
    });
    return { items };
  }
}
