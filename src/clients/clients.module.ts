import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { IntakeModule } from '../intake/intake.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientSupportController } from '../support/client-support.controller';
import { StripeService } from '../billing/stripe/stripe.service';

@Module({
  imports: [AccessContextModule, DatabaseModule, IntakeModule],
  controllers: [ClientsController, ClientSupportController],
  providers: [ClientsService, StripeService],
  exports: [ClientsService],
})
export class ClientsModule {}