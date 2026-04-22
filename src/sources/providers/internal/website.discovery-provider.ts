import { Injectable } from '@nestjs/common';
import { DiscoveryCandidate } from '../../types/discovery.types';

@Injectable()
export class WebsiteDiscoveryProvider {
  async discover(input: {
    clientWebsiteUrl?: string | null;
    existingCandidates: DiscoveryCandidate[];
  }): Promise<DiscoveryCandidate[]> {
    const website = typeof input.clientWebsiteUrl === 'string' ? input.clientWebsiteUrl.trim() : '';
    if (!website) return [];

    const domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
    return input.existingCandidates
      .filter((item) => !item.domain)
      .slice(0, 10)
      .map((item, index) => ({
        ...item,
        sourceType: item.sourceType === 'SEARCH' ? 'SEARCH' : 'WEBSITE',
        websiteUrl: item.websiteUrl || website,
        domain,
        confidence: Math.max(item.confidence, 68 - index),
        evidence: {
          ...item.evidence,
          websiteDerivedFromClientContext: website,
        },
      }));
  }
}
