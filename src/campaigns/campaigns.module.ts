import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { WorkersModule } from '../workers/workers.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [DatabaseModule, WorkflowsModule, AccessContextModule, WorkersModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
