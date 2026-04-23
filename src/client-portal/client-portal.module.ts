import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { BillingModule } from '../billing/billing.module';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ClientPortalController } from './client-portal.controller';
import { ClientPortalService } from './client-portal.service';

@Module({
  imports: [
    AccessContextModule,
    DatabaseModule,
    BillingModule,
    DeliverabilityModule,
    CampaignsModule,
    WorkflowsModule,
  ],
  controllers: [ClientPortalController],
  providers: [ClientPortalService],
  exports: [ClientPortalService],
})
export class ClientPortalModule {}
