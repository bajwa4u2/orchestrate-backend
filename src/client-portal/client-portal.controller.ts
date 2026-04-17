import { Controller, Get, Headers } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { ClientPortalService } from './client-portal.service';

@Controller('client')
export class ClientPortalController {
  constructor(
    private readonly clientPortalService: ClientPortalService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('overview')
  async overview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.overview(context.organizationId!, context.clientId!);
  }

  @Get('billing/overview')
  async billingOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.overview(context.organizationId!, context.clientId!);
  }

  @Get('leads')
  async leads(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.leads(context.organizationId!, context.clientId!);
  }

  @Get('invoices')
  async invoices(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.invoices(context.organizationId!, context.clientId!);
  }

  @Get('statements')
  async statements(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.statements(context.organizationId!, context.clientId!);
  }

  @Get('agreements')
  async agreements(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.agreements(context.organizationId!, context.clientId!);
  }

  @Get('reminders')
  async reminders(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.reminders(context.organizationId!, context.clientId!);
  }

  @Get('notifications')
  async notifications(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.notifications(context.organizationId!, context.clientId!);
  }

  @Get('email-dispatches')
  async emailDispatches(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.clientPortalService.emailDispatches(context.organizationId!, context.clientId!);
  }
}
