import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApolloProvider } from './providers/apollo.provider';
import { ExternalLeadSearchResult, LeadSourceSearchInput } from './lead-sources.types';
import { ProviderFallbackService } from '../providers/provider-fallback.service';

@Injectable()
export class LeadSourcesService {
  constructor(
    private readonly apolloProvider: ApolloProvider,
    private readonly providerFallbackService: ProviderFallbackService,
  ) {}

  async searchApollo(input: LeadSourceSearchInput): Promise<ExternalLeadSearchResult> {
    const decision = await this.providerFallbackService.canUseApollo({
      organizationId: input.organizationId,
      clientId: input.clientId,
      campaignId: input.campaignId,
      reason: 'internal_paths_insufficient',
      budgetUnitsRequested: input.targeting.maxResults,
      internalResultCount: 0,
    });

    if (!decision.allowed) {
      throw new ServiceUnavailableException(`Apollo fallback rejected: ${decision.reason}`);
    }

    const result = await this.apolloProvider.search(input);
    await this.providerFallbackService.logUsage({
      organizationId: input.organizationId,
      clientId: input.clientId,
      campaignId: input.campaignId,
      providerName: 'APOLLO',
      reason: 'internal_paths_insufficient',
      invocationType: 'lead_search',
      costUnits: input.targeting.maxResults,
      resultCount: result.importedCount,
      outcomeSummary: `Imported ${result.importedCount} Apollo prospects`,
      metadataJson: result.querySummary,
    });

    return result;
  }
}
