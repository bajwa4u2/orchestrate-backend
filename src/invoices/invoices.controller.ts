import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SendInvoiceEmailDto } from './dto/send-invoice-email.dto';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly invoiceDeliveryService: InvoiceDeliveryService,
    private readonly db: PrismaService,
  ) {}

  @Post()
  async createDraft(@Body() body: any) {
    return this.invoicesService.createDraftInvoice({
      organizationId: body.organizationId,
      clientId: body.clientId,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      items: Array.isArray(body.items) ? body.items : [],
      createdById: body.createdById,
    });
  }

  @Get()
  async list() {
    return this.db.invoice.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.db.invoice.findUnique({
      where: { id },
    });
  }

  @Patch(':id/issue')
  async issue(@Param('id') id: string) {
    return this.invoicesService.issueInvoice(id);
  }

  @Get(':id/pdf')
  async generatePdf(@Param('id') id: string) {
    return this.invoicePdfService.generateAndPersistPdf(id);
  }

  @Post(':id/send')
  async sendInvoiceEmail(@Param('id') id: string, @Body() body: SendInvoiceEmailDto) {
    return this.invoiceDeliveryService.sendInvoiceEmail({
      invoiceId: id,
      toEmail: body?.toEmail,
      attachPdf: body?.attachPdf,
    });
  }
}
