import { Module } from '@nestjs/common';
import { AiGovernanceModule } from '../../ai/governance/ai-governance.module';
import { DatabaseModule } from '../../database/database.module';
import { InboxSyncWorkerService } from './inbox-sync.worker.service';

@Module({
  imports: [AiGovernanceModule, DatabaseModule],
  providers: [InboxSyncWorkerService],
  exports: [InboxSyncWorkerService],
})
export class InboxSyncWorkerModule {}
