import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { BillingModule } from '../billing/billing.module';
import { ClientPortalController } from './client-portal.controller';
import { ClientPortalService } from './client-portal.service';

@Module({
  imports: [AccessContextModule, BillingModule],
  controllers: [ClientPortalController],
  providers: [ClientPortalService],
})
export class ClientPortalModule {}
