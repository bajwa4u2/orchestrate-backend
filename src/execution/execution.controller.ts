import { Body, Controller, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { DispatchDueJobsDto } from './dto/dispatch-due-jobs.dto';
import { QueueLeadSendDto } from './dto/queue-lead-send.dto';
import { RunJobDto } from './dto/run-job.dto';
import { ExecutionService } from './execution.service';

@Controller('execution')
export class ExecutionController {
  constructor(
    private readonly executionService: ExecutionService,
    private readonly accessContextService: AccessContextService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('leads/:leadId/queue-first-send')
  async queueLeadFirstSend(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
    @Body() dto: QueueLeadSendDto,
  ) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'execution.queue',
    );
    await this.assertLeadAccessible(context.organizationId!, context.clientId!, leadId);

    return this.executionService.queueLeadSend(leadId, {
      ...dto,
      jobType: 'FIRST_SEND',
    });
  }

  @Post('leads/:leadId/queue-follow-up')
  async queueLeadFollowUp(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
    @Body() dto: QueueLeadSendDto,
  ) {
    const context = await this.accessContextService.requireClient(headers);
    await this.subscriptionsService.assertClientCapability(
      context.organizationId!,
      context.clientId!,
      'execution.queue',
    );
    await this.assertLeadAccessible(context.organizationId!, context.clientId!, leadId);

    return this.executionService.queueLeadSend(leadId, {
      ...dto,
      jobType: 'FOLLOWUP_SEND',
    });
  }

  @Post('dispatch-due')
  async dispatchDue(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: DispatchDueJobsDto,
    @Query('organizationId') organizationId?: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.executionService.dispatchDueJobs({
      ...dto,
      organizationId: organizationId || context.organizationId,
    });
  }

  @Post('jobs/:jobId/run')
  async runJob(
    @Headers() headers: Record<string, unknown>,
    @Param('jobId') jobId: string,
    @Body() dto: RunJobDto,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.executionService.runJob(jobId, dto);
  }

  private async assertLeadAccessible(organizationId: string, clientId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId, clientId },
      select: { id: true },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found in the active client workspace');
    }
  }
}
