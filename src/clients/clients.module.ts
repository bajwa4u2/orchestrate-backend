import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { IntakeModule } from '../intake/intake.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { BillingModule } from '../billing/billing.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientSupportController } from '../support/client-support.controller';
import { ClientCampaignController } from './client-campaign.controller';

@Module({
  imports: [
    AccessContextModule,
    DatabaseModule,
    IntakeModule,
    CampaignsModule,
    DeliverabilityModule,
    WorkflowsModule,
    BillingModule,
  ],
  controllers: [ClientsController, ClientCampaignController, ClientSupportController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
