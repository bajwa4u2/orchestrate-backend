import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { IntakeModule } from '../intake/intake.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientSupportController } from '../support/client-support.controller';
import { StripeService } from '../billing/stripe/stripe.service';
import { ClientCampaignController } from './client-campaign.controller';

@Module({
  imports: [AccessContextModule, DatabaseModule, IntakeModule, CampaignsModule],
  controllers: [
    ClientsController,
    ClientCampaignController,
    ClientSupportController,
  ],
  providers: [ClientsService, StripeService],
  exports: [ClientsService],
})
export class ClientsModule {}
