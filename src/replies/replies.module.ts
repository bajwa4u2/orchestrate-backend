import { Module, forwardRef } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { AiGovernanceModule } from '../ai/governance/ai-governance.module';
import { DatabaseModule } from '../database/database.module';
import { ExecutionModule } from '../execution/execution.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { RepliesController } from './replies.controller';
import { RepliesService } from './replies.service';

@Module({
  imports: [
    DatabaseModule,
    WorkflowsModule,
    AccessContextModule,
    AiGovernanceModule,
    DeliverabilityModule,
    forwardRef(() => ExecutionModule),
  ],
  controllers: [RepliesController],
  providers: [RepliesService],
  exports: [RepliesService],
})
export class RepliesModule {}
