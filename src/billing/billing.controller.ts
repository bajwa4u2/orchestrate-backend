import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { ReceiptDeliveryService } from './receipt-delivery.service';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly receiptDeliveryService: ReceiptDeliveryService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('overview')
  async overview(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.billingService.overview(context.organizationId!, clientId);
  }

  @Get('invoices')
  async listInvoices(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.billingService.listInvoices(context.organizationId!, clientId);
  }

  @Get('receipts')
  async listReceipts(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.billingService.listReceipts(context.organizationId!, clientId);
  }

  @Get('receipts/:receiptId/render')
  async renderReceipt(@Headers() headers: Record<string, unknown>, @Param('receiptId') receiptId: string) {
    await this.accessContextService.requireOperator(headers);
    return this.receiptDeliveryService.renderReceipt(receiptId);
  }

  @Post('receipts/:receiptId/send')
  async sendReceipt(@Headers() headers: Record<string, unknown>, @Param('receiptId') receiptId: string) {
    await this.accessContextService.requireOperator(headers);
    return this.receiptDeliveryService.sendReceiptEmail(receiptId);
  }

  @Post('invoices')
  async createInvoice(@Headers() headers: Record<string, unknown>, @Body() dto: CreateInvoiceDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.billingService.createInvoice(context.organizationId!, context.userId, dto);
  }

  @Post('payments')
  async recordPayment(@Headers() headers: Record<string, unknown>, @Body() dto: RecordPaymentDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.billingService.recordPayment(context.organizationId!, context.userId, dto);
  }

  @Post('subscribe')
  async subscribe(
    @Headers() headers: Record<string, unknown>,
    @Body() body: { plan: 'OPPORTUNITY' | 'REVENUE'; tier: 'FOCUSED' | 'MULTI' | 'PRECISION' },
  ) {
    const context = await this.accessContextService.requireClient(headers);
    return this.billingService.createSubscriptionIntent({
      organizationId: context.organizationId!,
      clientId: context.clientId!,
      userId: context.userId!,
      email: context.email,
      plan: body.plan,
      tier: body.tier,
    });
  }
  
  @Get('subscription')
  async getSubscription(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);

    return this.billingService.getClientSubscription(
      context.organizationId!,
      context.clientId!,
    );
  }

  @Post('portal')
  async createPortal(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.billingService.createPortalSession({
      organizationId: context.organizationId!,
      clientId: context.clientId!,
    });
  }
}