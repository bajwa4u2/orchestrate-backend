import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { DirectoryDiscoveryProvider } from './providers/internal/directory.discovery-provider';
import { SearchDiscoveryProvider } from './providers/internal/search.discovery-provider';
import { WebsiteDiscoveryProvider } from './providers/internal/website.discovery-provider';
import { InternalDiscoveryOrchestrator } from './internal-discovery.orchestrator';
import { SourcePlannerService } from './source-planner.service';
import { SourcesController } from './sources.controller';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [SourcesController],
  providers: [
    SearchDiscoveryProvider,
    DirectoryDiscoveryProvider,
    WebsiteDiscoveryProvider,
    InternalDiscoveryOrchestrator,
    SourcePlannerService,
  ],
  exports: [SourcePlannerService],
})
export class SourcesModule {}
