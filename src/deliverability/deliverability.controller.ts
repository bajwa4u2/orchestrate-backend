import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { CreateSendPolicyDto } from './dto/create-send-policy.dto';
import { CreateSendingDomainDto } from './dto/create-sending-domain.dto';
import { CreateSuppressionEntryDto } from './dto/create-suppression-entry.dto';
import { RegisterBounceDto } from './dto/register-bounce.dto';
import { RegisterComplaintDto } from './dto/register-complaint.dto';
import { DeliverabilityService } from './deliverability.service';

@Controller('deliverability')
export class DeliverabilityController {
  constructor(private readonly deliverabilityService: DeliverabilityService) {}

  @Post('domains')
  createDomain(@Body() dto: CreateSendingDomainDto) {
    return this.deliverabilityService.createDomain(dto);
  }

  @Post('mailboxes')
  createMailbox(@Body() dto: CreateMailboxDto) {
    return this.deliverabilityService.createMailbox(dto);
  }

  @Post('policies')
  createPolicy(@Body() dto: CreateSendPolicyDto) {
    return this.deliverabilityService.createPolicy(dto);
  }

  @Post('suppressions')
  createSuppression(@Body() dto: CreateSuppressionEntryDto) {
    return this.deliverabilityService.createSuppression(dto);
  }

  @Post('mailboxes/:mailboxId/bounces')
  registerBounce(@Param('mailboxId') mailboxId: string, @Body() dto: RegisterBounceDto) {
    return this.deliverabilityService.registerBounce(mailboxId, dto);
  }

  @Post('mailboxes/:mailboxId/complaints')
  registerComplaint(@Param('mailboxId') mailboxId: string, @Body() dto: RegisterComplaintDto) {
    return this.deliverabilityService.registerComplaint(mailboxId, dto);
  }

  @Post('mailboxes/:mailboxId/refresh-health')
  refreshMailboxHealth(@Param('mailboxId') mailboxId: string) {
    return this.deliverabilityService.refreshMailboxHealth(mailboxId);
  }

  @Get('overview')
  overview(@Query('organizationId') organizationId?: string, @Query('clientId') clientId?: string) {
    return this.deliverabilityService.overview({ organizationId, clientId });
  }
}
