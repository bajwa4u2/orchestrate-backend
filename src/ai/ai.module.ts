import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessContextModule } from '../access-context/access-context.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { LeadAgent } from './agents/lead.agent';
import { SequenceAgent } from './agents/sequence.agent';
import { StrategyAgent } from './agents/strategy.agent';
import { WriterAgent } from './agents/writer.agent';
import { AiGovernanceModule } from './governance/ai-governance.module';
import { AiGrowthService } from './services/ai-growth.service';
import { AiRevenueDraftsService } from './services/ai-revenue-drafts.service';

@Module({
  imports: [ConfigModule, WorkflowsModule, AccessContextModule, AiGovernanceModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiGrowthService,
    AiRevenueDraftsService,
    StrategyAgent,
    LeadAgent,
    WriterAgent,
    SequenceAgent,
  ],
  exports: [
    AiGovernanceModule,
    AiService,
  ],
})
export class AiModule {}
