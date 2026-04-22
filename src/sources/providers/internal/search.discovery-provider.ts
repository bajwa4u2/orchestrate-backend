import { Injectable } from '@nestjs/common';
import { DiscoveryCandidate } from '../../types/discovery.types';

@Injectable()
export class SearchDiscoveryProvider {
  async discover(input: {
    campaignName: string;
    objective?: string | null;
    offerSummary?: string | null;
    seedProspects: Array<Record<string, unknown>>;
    geography: string[];
    limit: number;
  }): Promise<DiscoveryCandidate[]> {
    return input.seedProspects.slice(0, input.limit).map((seed, index) => ({
      sourceType: 'SEARCH',
      companyName: this.readString(seed.companyName) || this.readString(seed.company) || `${input.campaignName} Search Prospect ${index + 1}`,
      personName: this.readString(seed.contactFullName) || this.readString(seed.personName) || undefined,
      inferredRole: this.readString(seed.title) || 'Decision Maker',
      websiteUrl: this.readString(seed.websiteUrl) || undefined,
      domain: this.normalizeDomain(this.readString(seed.domain) || this.readString(seed.websiteUrl) || ''),
      geography: this.readString(seed.region) || input.geography[0] || undefined,
      confidence: 82 - index,
      evidence: {
        provider: 'INTERNAL_SEARCH',
        objective: input.objective,
        offerSummary: input.offerSummary,
        seed,
      },
    }));
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeDomain(value: string) {
    const cleaned = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
    return cleaned || undefined;
  }
}
