import { Module } from '@nestjs/common';
import { AiGovernanceModule } from '../../ai/governance/ai-governance.module';
import { DatabaseModule } from '../../database/database.module';
import { FirstSendWorkerModule } from '../first_send/first-send.worker.module';
import { FollowUpWorkerService } from './follow-up.worker.service';

@Module({
  imports: [AiGovernanceModule, DatabaseModule, FirstSendWorkerModule],
  providers: [FollowUpWorkerService],
  exports: [FollowUpWorkerService],
})
export class FollowUpWorkerModule {}
