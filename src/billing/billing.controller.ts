import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
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
}
