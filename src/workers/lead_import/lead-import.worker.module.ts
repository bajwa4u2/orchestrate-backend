import { Module } from '@nestjs/common';
import { AiGovernanceModule } from '../../ai/governance/ai-governance.module';
import { AdaptationModule } from '../../adaptation/adaptation.module';
import { DatabaseModule } from '../../database/database.module';
import { DeliverabilityModule } from '../../deliverability/deliverability.module';
import { LeadSourcesModule } from '../../lead-sources/lead-sources.module';
import { ProvidersModule } from '../../providers/providers.module';
import { QualificationModule } from '../../qualification/qualification.module';
import { ReachabilityModule } from '../../reachability/reachability.module';
import { SignalsModule } from '../../signals/signals.module';
import { SourcesModule } from '../../sources/sources.module';
import { StrategyModule } from '../../strategy/strategy.module';
import { LeadImportWorkerService } from './lead-import.worker.service';

@Module({
  imports: [
    AiGovernanceModule,
    DatabaseModule,
    DeliverabilityModule,
    LeadSourcesModule,
    ProvidersModule,
    StrategyModule,
    SignalsModule,
    SourcesModule,
    ReachabilityModule,
    QualificationModule,
    AdaptationModule,
  ],
  providers: [LeadImportWorkerService],
  exports: [LeadImportWorkerService],
})
export class LeadImportWorkerModule {}
