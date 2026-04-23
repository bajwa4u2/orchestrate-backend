import { Module, forwardRef } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { BillingModule } from '../billing/billing.module';
import { ControlModule } from '../control/control.module';
import { ClientsModule } from '../clients/clients.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { EmailsModule } from '../emails/emails.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { ExecutionModule } from '../execution/execution.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';

@Module({
  imports: [
    AccessContextModule,
    BillingModule,
    ControlModule,
    ClientsModule,
    CampaignsModule,
    forwardRef(() => EmailsModule),
    DeliverabilityModule,
    forwardRef(() => ExecutionModule),
    WorkflowsModule,
  ],
  controllers: [OperatorController],
  providers: [OperatorService],
  exports: [OperatorService],
})
export class OperatorModule {}
