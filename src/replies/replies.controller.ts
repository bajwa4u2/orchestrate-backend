import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
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
      threadKey?: string;
      receivedAt?: string;
    },
  ) {
    const configuredSecret = process.env.INBOUND_REPLY_SECRET?.trim();
    if (configuredSecret) {
      const providedSecret = String(headers['x-orchestrate-inbound-secret'] ?? headers['X-Orchestrate-Inbound-Secret'] ?? '').trim();
      if (!providedSecret || providedSecret !== configuredSecret) {
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
      const operatorContext = await this.accessContextService.requireOperator(headers);
      if (!clientId) {
        throw new BadRequestException('clientId is required for operator reply listing');
      }
      return this.repliesService.listForClient(clientId);
    }
  }
}
