import { Body, Controller, Get, Headers, Post, Query, Req } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { SendTemplatedEmailDto } from './dto/send-templated-email.dto';
import { EmailsService } from './emails.service';

@Controller('emails')
export class EmailsController {
  constructor(
    private readonly emailsService: EmailsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('dispatches')
  async listDispatches(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.emailsService.listDispatches(context.organizationId!, clientId);
  }

  @Get('dispatches/me')
  async listClientDispatches(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireClient(headers);
    return this.emailsService.listDispatches(context.organizationId!, context.clientId!);
  }

  @Post('send-template')
  async sendTemplate(@Headers() headers: Record<string, unknown>, @Body() dto: SendTemplatedEmailDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.emailsService.sendTemplateEmail(context.organizationId!, context.userId, dto);
  }

  @Post('inbound')
  async handleInbound(@Req() req: any, @Headers() headers: Record<string, unknown>) {
    const rawBody = this.extractRawBody(req);
    return this.emailsService.handleInboundWebhook(rawBody, headers);
  }

  @Post('webhook')
  async handleWebhook(@Req() req: any, @Headers() headers: Record<string, unknown>) {
    const rawBody = this.extractRawBody(req);
    return this.emailsService.handleInboundWebhook(rawBody, headers);
  }

  private extractRawBody(req: any): string {
    const raw = req?.rawBody;

    if (typeof raw === 'string') {
      return raw;
    }

    if (raw && typeof raw === 'object' && typeof raw.toString === 'function') {
      return raw.toString();
    }

    if (typeof req?.body === 'string') {
      return req.body;
    }

    if (req?.body && typeof req.body === 'object') {
      return JSON.stringify(req.body);
    }

    return '';
  }
}
