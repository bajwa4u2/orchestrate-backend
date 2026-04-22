import { Controller, Get, Headers, Param } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { ProviderRegistryService } from './provider-registry.service';

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly registry: ProviderRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  async status(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireOperator(headers);
    return { items: this.registry.listAvailability() };
  }

  @Get('usage/campaigns/:campaignId')
  async usage(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    const items = await this.prisma.providerUsageLog.findMany({
      where: {
        campaignId,
        organizationId: context.organizationId!,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return { items };
  }
}
