import { Injectable } from '@nestjs/common';
import { ExternalLeadSearchResult, LeadSourceSearchInput } from './lead-sources.types';
import { ApolloProvider } from './providers/apollo.provider';

@Injectable()
export class LeadSourcesService {
  constructor(private readonly apolloProvider: ApolloProvider) {}

  async searchApollo(input: LeadSourceSearchInput): Promise<ExternalLeadSearchResult> {
    return this.apolloProvider.search(input);
  }
}
