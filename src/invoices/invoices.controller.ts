import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
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
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post()
  async createDraft(@Headers() headers: Record<string, unknown>, @Body() body: any) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.invoicesService.createDraftInvoice({
      organizationId: context.organizationId!,
      clientId: body.clientId,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      items: Array.isArray(body.items) ? body.items : [],
      createdById: context.userId,
    });
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.db.invoice.findMany({
      where: { organizationId: context.organizationId! },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async getOne(@Headers() headers: Record<string, unknown>, @Param('id') id: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.db.invoice.findFirst({
      where: { id, organizationId: context.organizationId! },
    });
  }

  @Patch(':id/issue')
  async issue(@Headers() headers: Record<string, unknown>, @Param('id') id: string) {
    const context = await this.accessContextService.requireOperator(headers);
    await this.db.invoice.findFirstOrThrow({ where: { id, organizationId: context.organizationId! }, select: { id: true } });
    return this.invoicesService.issueInvoice(id);
  }

  @Get(':id/pdf')
  async generatePdf(@Headers() headers: Record<string, unknown>, @Param('id') id: string) {
    const context = await this.accessContextService.requireOperator(headers);
    await this.db.invoice.findFirstOrThrow({ where: { id, organizationId: context.organizationId! }, select: { id: true } });
    return this.invoicePdfService.generateAndPersistPdf(id);
  }

  @Post(':id/send')
  async sendInvoiceEmail(
    @Headers() headers: Record<string, unknown>,
    @Param('id') id: string,
    @Body() body: SendInvoiceEmailDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    await this.db.invoice.findFirstOrThrow({ where: { id, organizationId: context.organizationId! }, select: { id: true } });
    return this.invoiceDeliveryService.sendInvoiceEmail({
      invoiceId: id,
      toEmail: body?.toEmail,
      attachPdf: body?.attachPdf,
    });
  }
}
