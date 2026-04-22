import { Injectable } from '@nestjs/common';
import { DiscoveryCandidate } from '../../types/discovery.types';

@Injectable()
export class DirectoryDiscoveryProvider {
  async discover(input: {
    clientName: string;
    industry?: string | null;
    geography: string[];
    limit: number;
  }): Promise<DiscoveryCandidate[]> {
    const geographyLabel = input.geography[0] || 'target market';
    const base = [`${input.clientName} Directory Candidate`, `${input.industry || 'Industry'} Listings Candidate`];

    return base.slice(0, input.limit).map((companyName, index) => ({
      sourceType: 'DIRECTORY',
      companyName,
      inferredRole: 'Owner',
      geography: geographyLabel,
      confidence: 70 - index * 3,
      evidence: {
        provider: 'INTERNAL_DIRECTORY',
        geographyLabel,
      },
    }));
  }
}
