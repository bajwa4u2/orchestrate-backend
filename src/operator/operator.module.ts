import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { BillingModule } from '../billing/billing.module';
import { ControlModule } from '../control/control.module';
import { EmailsModule } from '../emails/emails.module';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';

@Module({
  imports: [AccessContextModule, BillingModule, ControlModule, EmailsModule],
  controllers: [OperatorController],
  providers: [OperatorService],
})
export class OperatorModule {}
