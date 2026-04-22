import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { ProviderCostGuardService } from './provider-cost-guard.service';
import { ProviderPolicyService } from './provider-policy.service';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderUsePolicyInput } from './types/provider.types';

@Injectable()
export class ProviderFallbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly policy: ProviderPolicyService,
    private readonly costGuard: ProviderCostGuardService,
  ) {}

  async canUseApollo(input: ProviderUsePolicyInput) {
    if (!this.registry.isEnabled('APOLLO')) {
      return { allowed: false, reason: 'apollo_unavailable' };
    }

    const policyDecision = this.policy.canUseFallback(input);
    if (!policyDecision.allowed) {
      return policyDecision;
    }

    const costDecision = this.costGuard.approve(input.budgetUnitsRequested);
    if (!costDecision.allowed) {
      return costDecision;
    }

    return { allowed: true, reason: 'apollo_fallback_allowed' };
  }

  async logUsage(input: {
    organizationId: string;
    clientId: string;
    campaignId: string;
    opportunityProfileId?: string | null;
    providerName: string;
    reason: string;
    invocationType: string;
    costUnits?: number;
    resultCount?: number;
    outcomeSummary?: string;
    metadataJson?: Record<string, unknown>;
  }) {
    return this.prisma.providerUsageLog.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        opportunityProfileId: input.opportunityProfileId ?? null,
        providerName: input.providerName,
        reason: input.reason,
        invocationType: input.invocationType,
        costUnits: input.costUnits ?? 0,
        resultCount: input.resultCount ?? 0,
        outcomeSummary: input.outcomeSummary ?? null,
        metadataJson: toPrismaJson(input.metadataJson),
      },
    });
  }
}
