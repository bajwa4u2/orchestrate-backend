import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { EmailsModule } from '../emails/emails.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InvoicesController } from './invoices.controller';
import { InvoiceDocumentBuilder } from './dto/invoice-document.builder';
import { InvoiceEmailRenderer } from './dto/invoice-email.renderer';
import { InvoiceHtmlRenderer } from './dto/invoice-html.renderer';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [DatabaseModule, EmailsModule, WorkflowsModule, AccessContextModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoiceDocumentBuilder,
    InvoiceEmailRenderer,
    InvoiceHtmlRenderer,
    InvoicePdfService,
    InvoiceDeliveryService,
  ],
  exports: [
    InvoicesService,
    InvoiceDocumentBuilder,
    InvoiceEmailRenderer,
    InvoiceHtmlRenderer,
    InvoicePdfService,
    InvoiceDeliveryService,
  ],
})
export class InvoicesModule {}
