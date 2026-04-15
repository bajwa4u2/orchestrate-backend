import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { ExecutionModule } from '../execution/execution.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [
    AccessContextModule,
    DatabaseModule,
    DeliverabilityModule,
    ExecutionModule,
    SubscriptionsModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
