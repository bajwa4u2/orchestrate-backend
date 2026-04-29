import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { structuredLog } from '../common/observability/structured-logger';
import { RepliesService } from './replies.service';

@Controller('replies')
export class RepliesController {
  constructor(
    private readonly repliesService: RepliesService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post('inbound')
  async ingestInbound(
    @Headers() headers: Record<string, unknown>,
    @Body()
    body: {
      mailboxEmail?: string;
      fromEmail: string;
      subjectLine?: string;
      bodyText?: string;
      externalMessageId?: string;
      providerThreadId?: string;
      threadKey?: string;
      receivedAt?: string;
    },
  ) {
    const configuredSecret = process.env.INBOUND_REPLY_SECRET?.trim();
    if (!configuredSecret && process.env.NODE_ENV === 'production') {
      this.logWebhookFailure(headers, 'missing_secret_config');
      throw new UnauthorizedException('Inbound reply secret is required');
    }
    if (configuredSecret) {
      const providedSecret = String(headers['x-orchestrate-inbound-secret'] ?? headers['X-Orchestrate-Inbound-Secret'] ?? '').trim();
      if (!providedSecret || providedSecret !== configuredSecret) {
        this.logWebhookFailure(headers, 'invalid_secret');
        throw new UnauthorizedException('Invalid inbound reply secret');
      }
    }
    return this.repliesService.ingestInboundReply(body);
  }

  @Post(':id/process')
  async process(@Headers() headers: Record<string, unknown>, @Param('id') id: string) {
    await this.accessContextService.requireOperator(headers);
    return this.repliesService.processReply(id);
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    try {
      const clientContext = await this.accessContextService.requireClient(headers);
      return this.repliesService.listForClient(clientContext.clientId!);
    } catch {
      await this.accessContextService.requireOperator(headers);
      if (!clientId) {
        throw new BadRequestException('clientId is required for operator reply listing');
      }
      return this.repliesService.listForClient(clientId);
    }
  }

  private logWebhookFailure(headers: Record<string, unknown>, reason: string) {
    structuredLog('warn', 'webhook.failure', {
      provider: 'inbound_reply',
      reason,
      requestId: this.readHeader(headers, 'x-request-id'),
      correlationId: this.readHeader(headers, 'x-correlation-id'),
    });
  }

  private readHeader(headers: Record<string, unknown>, key: string) {
    const raw = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(raw)) return raw[0] ? String(raw[0]).trim() : undefined;
    if (raw == null) return undefined;
    const value = String(raw).trim();
    return value.length ? value : undefined;
  }
}
