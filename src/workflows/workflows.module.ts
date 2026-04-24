import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { AiGovernanceModule } from '../ai/governance/ai-governance.module';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [DatabaseModule, AccessContextModule, AiGovernanceModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
