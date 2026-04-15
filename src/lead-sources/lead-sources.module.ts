import { Module } from '@nestjs/common';
import { LeadSourcesService } from './lead-sources.service';
import { ApolloProvider } from './providers/apollo.provider';

@Module({
  providers: [LeadSourcesService, ApolloProvider],
  exports: [LeadSourcesService],
})
export class LeadSourcesModule {}
