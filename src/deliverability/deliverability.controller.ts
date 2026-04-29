import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { CreateSendPolicyDto } from './dto/create-send-policy.dto';
import { CreateSendingDomainDto } from './dto/create-sending-domain.dto';
import { CreateSuppressionEntryDto } from './dto/create-suppression-entry.dto';
import { RegisterBounceDto } from './dto/register-bounce.dto';
import { RegisterComplaintDto } from './dto/register-complaint.dto';
import { DeliverabilityService } from './deliverability.service';

@Controller('deliverability')
export class DeliverabilityController {
  constructor(
    private readonly deliverabilityService: DeliverabilityService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post('domains')
  async createDomain(@Headers() headers: Record<string, unknown>, @Body() dto: CreateSendingDomainDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.createDomain({
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Post('mailboxes')
  async createMailbox(@Headers() headers: Record<string, unknown>, @Body() dto: CreateMailboxDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.createMailbox({
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Post('policies')
  async createPolicy(@Headers() headers: Record<string, unknown>, @Body() dto: CreateSendPolicyDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.createPolicy({
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Post('suppressions')
  async createSuppression(@Headers() headers: Record<string, unknown>, @Body() dto: CreateSuppressionEntryDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.createSuppression({
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Post('mailboxes/:mailboxId/bounces')
  async registerBounce(
    @Headers() headers: Record<string, unknown>,
    @Param('mailboxId') mailboxId: string,
    @Body() dto: RegisterBounceDto,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.registerBounce(mailboxId, dto);
  }

  @Post('mailboxes/:mailboxId/complaints')
  async registerComplaint(
    @Headers() headers: Record<string, unknown>,
    @Param('mailboxId') mailboxId: string,
    @Body() dto: RegisterComplaintDto,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.registerComplaint(mailboxId, dto);
  }

  @Post('mailboxes/:mailboxId/refresh-health')
  async refreshMailboxHealth(@Headers() headers: Record<string, unknown>, @Param('mailboxId') mailboxId: string) {
    await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.refreshMailboxHealth(mailboxId);
  }

  @Post('mailboxes/:mailboxId/reconnect')
  async reconnectMailbox(@Headers() headers: Record<string, unknown>, @Param('mailboxId') mailboxId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.prepareMailboxReconnect(mailboxId, context.organizationId!);
  }

  @Get('overview')
  async overview(
    @Headers() headers: Record<string, unknown>,
    @Query('clientId') clientId?: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.deliverabilityService.overview({ organizationId: context.organizationId!, clientId });
  }
}
