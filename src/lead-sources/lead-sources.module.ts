import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProvidersModule } from '../providers/providers.module';
import { LeadSourcesService } from './lead-sources.service';
import { ApolloProvider } from './providers/apollo.provider';

@Module({
  imports: [ConfigModule, ProvidersModule],
  providers: [LeadSourcesService, ApolloProvider],
  exports: [LeadSourcesService],
})
export class LeadSourcesModule {}
