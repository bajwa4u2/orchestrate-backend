import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { EmailsModule } from '../emails/emails.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [AccessContextModule, EmailsModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
