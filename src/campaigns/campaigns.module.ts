import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AccessContextModule, SubscriptionsModule, WorkflowsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
