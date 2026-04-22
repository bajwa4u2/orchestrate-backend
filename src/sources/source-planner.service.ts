import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { evaluateSourcePolicy } from '../common/policy/data-policy';
import { InternalDiscoveryOrchestrator } from './internal-discovery.orchestrator';

@Injectable()
export class SourcePlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: InternalDiscoveryOrchestrator,
  ) {}

  async discoverForCampaign(input: { campaignId: string; organizationId?: string }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, ...(input.organizationId ? { organizationId: input.organizationId } : {}) },
      include: { client: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const opportunity = await this.prisma.opportunityProfile.findFirst({ where: { campaignId: campaign.id }, orderBy: { createdAt: 'desc' } });
    const sourcePlan = await this.prisma.sourcePlan.findFirst({ where: { campaignId: campaign.id }, orderBy: { createdAt: 'desc' } });
    if (!opportunity || !sourcePlan) {
      throw new NotFoundException('Strategy and source plan must exist before discovery.');
    }

    const geographyScope = this.asObject(opportunity.geographyScope);
    const geography = [
      ...this.readStringArray(geographyScope.cities),
      ...this.readStringArray(geographyScope.regions),
      ...this.readStringArray(geographyScope.countries),
    ];
    const metadata = this.asObject(campaign.metadataJson);
    const seedProspects = this.readObjectArray(metadata.seedProspects);

    const sourcePolicies = ['SEARCH', 'DIRECTORY', 'WEBSITE'].map((sourceType) => ({
      sourceType,
      ...evaluateSourcePolicy({ sourceType }),
    }));
    const allowedSourceTypes = sourcePolicies
      .filter((item) => item.status !== 'BLOCKED')
      .map((item) => item.sourceType);

    return this.orchestrator.discover({
      organizationId: campaign.organizationId,
      clientId: campaign.clientId,
      campaignId: campaign.id,
      opportunityProfileId: opportunity.id,
      sourcePlanId: sourcePlan.id,
      campaignName: campaign.name,
      clientName: campaign.client.displayName || campaign.client.legalName,
      clientWebsiteUrl: campaign.client.websiteUrl,
      objective: campaign.objective,
      offerSummary: campaign.offerSummary,
      industry: campaign.client.industry,
      geography,
      seedProspects,
      limit: Math.max(10, Math.min(campaign.dailySendCap ?? 25, 50)),
      allowedSourceTypes,
      sourcePolicies,
    });
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }
  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  }
  private readObjectArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item) => ({ ...item }));
  }
}
