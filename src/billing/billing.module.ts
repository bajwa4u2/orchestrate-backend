import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { EmailsModule } from '../emails/emails.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { ReceiptDocumentBuilder } from './dto/receipt-document.builder';
import { ReceiptHtmlRenderer } from './dto/receipt-html.renderer';
import { ReceiptDeliveryService } from './receipt-delivery.service';
import { StripeService } from './stripe/stripe.service';
import { WebhookController } from './stripe/webhook.controller';

@Module({
  imports: [AccessContextModule, EmailsModule, WorkflowsModule],
  controllers: [BillingController, WebhookController],
  providers: [
    BillingService,
    ReceiptDocumentBuilder,
    ReceiptHtmlRenderer,
    ReceiptDeliveryService,
    StripeService,
  ],
  exports: [BillingService, ReceiptDeliveryService, StripeService],
})
export class BillingModule {}
