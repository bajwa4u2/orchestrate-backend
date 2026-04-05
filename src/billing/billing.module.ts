import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { EmailsModule } from '../emails/emails.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { ReceiptDocumentBuilder } from './dto/receipt-document.builder';
import { ReceiptHtmlRenderer } from './dto/receipt-html.renderer';
import { ReceiptDeliveryService } from './receipt-delivery.service';

@Module({
  imports: [AccessContextModule, EmailsModule],
  controllers: [BillingController],
  providers: [BillingService, ReceiptDocumentBuilder, ReceiptHtmlRenderer, ReceiptDeliveryService],
  exports: [BillingService, ReceiptDeliveryService],
})
export class BillingModule {}
