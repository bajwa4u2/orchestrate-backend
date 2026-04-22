import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { StrategyOutput } from './strategy.types';

@Injectable()
export class StrategyService {
  constructor(private readonly prisma: PrismaService) {}

  async generateForCampaign(input: {
    campaignId: string;
    organizationId?: string;
    preferredOpportunityType?: string;
  }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      },
      include: { client: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const industry = campaign.client.industry?.trim() || 'General';
    const geographyScope = this.readGeographyScope(campaign.client.scopeJson, campaign.metadataJson);
    const opportunityType =
      input.preferredOpportunityType?.trim() || this.inferOpportunityType(campaign.objective, industry);

    const strategy: StrategyOutput = {
      title: `${campaign.name} opportunity plan`,
      opportunityType,
      targetDescription:
        campaign.objective?.trim() || `${industry} opportunities aligned to ${campaign.name}`,
      signalPriorities: this.buildSignalPriorities(industry, campaign.objective),
      sourceOrder: ['SEARCH', 'DIRECTORY', 'WEBSITE', 'OPEN_DATA'],
      qualificationThresholds: {
        accept: 70,
        hold: 55,
      },
      fallback: {
        allowProviders: true,
        reasonCode: 'internal_paths_insufficient',
      },
      outreachPosture: {
        channel: 'EMAIL',
        tone: 'professional',
        angle: campaign.offerSummary?.trim() || 'timely opportunity-driven outreach',
      },
      retryPolicy: {
        maxDiscoveryPasses: 3,
        allowGeographyWidening: true,
      },
      planLimits: {
        maxDiscoveryEntities: Math.max(10, Math.min(campaign.dailySendCap ?? 25, 50)),
        maxExecutionQueue: Math.max(10, Math.min((campaign.dailySendCap ?? 25) * 2, 100)),
      },
    };

    const opportunityProfile = await this.prisma.opportunityProfile.create({
      data: {
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        title: strategy.title,
        opportunityType: strategy.opportunityType,
        targetDescription: strategy.targetDescription,
        geographyScope: toPrismaJson(geographyScope),
        serviceContext: campaign.objective ?? null,
        offerContext: campaign.offerSummary ?? null,
        exclusions: toPrismaJson(this.readExclusions(campaign.client.scopeJson, campaign.metadataJson)),
        strategyJson: toPrismaJson(strategy),
        status: 'ACTIVE',
      },
    });

    const sourcePlan = await this.prisma.sourcePlan.create({
      data: {
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        opportunityProfileId: opportunityProfile.id,
        planVersion: 1,
        sourcePriorityJson: toPrismaJson({ sourceOrder: strategy.sourceOrder }),
        fallbackPolicyJson: toPrismaJson(strategy.fallback),
        signalRulesJson: toPrismaJson({ signalPriorities: strategy.signalPriorities }),
        executionLimitsJson: toPrismaJson(strategy.planLimits),
        status: 'ACTIVE',
      },
    });

    return { campaign, opportunityProfile, sourcePlan, strategy };
  }

  private inferOpportunityType(objective?: string | null, industry?: string) {
    const text = `${objective ?? ''} ${industry ?? ''}`.toLowerCase();
    if (text.includes('renew') || text.includes('expiration')) return 'RENEWAL';
    if (text.includes('insurance')) return 'COVERAGE_CHANGE';
    if (text.includes('real estate')) return 'BUYER_OR_SELLER_TRIGGER';
    if (text.includes('hiring')) return 'GROWTH_SIGNAL';
    return 'REVENUE_OPPORTUNITY';
  }

  private buildSignalPriorities(industry?: string | null, objective?: string | null) {
    const text = `${industry ?? ''} ${objective ?? ''}`.toLowerCase();
    const priorities = ['NEW_BUSINESS', 'PUBLIC_TRIGGER', 'SERVICE_CHANGE'];
    if (text.includes('hiring') || text.includes('growth')) priorities.unshift('HIRING_GROWTH');
    if (text.includes('complaint') || text.includes('problem')) priorities.unshift('DISSATISFACTION');
    if (text.includes('renew') || text.includes('expire')) priorities.unshift('RENEWAL_WINDOW');
    return Array.from(new Set(priorities));
  }

  private readGeographyScope(scopeJson: unknown, metadataJson: unknown): Record<string, unknown> {
    const scope = this.asObject(scopeJson);
    const metadata = this.asObject(metadataJson);
    const geography = this.asObject(scope.geography);

    return {
      countries: this.readStringArray(geography.countries),
      regions: this.readStringArray(geography.regions),
      cities: this.readStringArray(geography.cities),
      targetRegions: this.readStringArray(this.asObject(metadata.targeting).regions),
    };
  }

  private readExclusions(scopeJson: unknown, metadataJson: unknown): Record<string, unknown> {
    const scope = this.asObject(scopeJson);
    const metadata = this.asObject(metadataJson);

    return {
      domains: this.readStringArray(scope.excludeDomains),
      companies: this.readStringArray(scope.excludeCompanies),
      keywords: this.readStringArray(this.asObject(metadata.targeting).exclusionKeywords),
    };
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
}