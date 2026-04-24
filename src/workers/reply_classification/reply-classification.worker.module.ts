import { Module } from '@nestjs/common';
import { AiGovernanceModule } from '../../ai/governance/ai-governance.module';
import { DatabaseModule } from '../../database/database.module';
import { ReplyClassificationWorkerService } from './reply-classification.worker.service';

@Module({
  imports: [AiGovernanceModule, DatabaseModule],
  providers: [ReplyClassificationWorkerService],
  exports: [ReplyClassificationWorkerService],
})
export class ReplyClassificationWorkerModule {}
