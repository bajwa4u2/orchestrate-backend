import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { AccessContextService } from '../access-context/access-context.service';
import { DispatchDueJobsDto } from './dto/dispatch-due-jobs.dto';
import { QueueLeadSendDto } from './dto/queue-lead-send.dto';
import { RunJobDto } from './dto/run-job.dto';
import { ExecutionService } from './execution.service';

@Controller('execution')
export class ExecutionController {
  constructor(
    private readonly executionService: ExecutionService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post('leads/:leadId/queue-first-send')
  async queueLeadFirstSend(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
    @Body() dto: QueueLeadSendDto,
  ) {
    await this.accessContextService.requireOperator(headers);
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
    await this.accessContextService.requireOperator(headers);
    return this.executionService.queueLeadSend(leadId, {
      ...dto,
      jobType: 'FOLLOWUP_SEND',
    });
  }

  @Post('dispatch-due')
  async dispatchDue(@Headers() headers: Record<string, unknown>, @Body() dto: DispatchDueJobsDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.executionService.dispatchDueJobs({
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Post('jobs/:jobId/run')
  async runJob(@Headers() headers: Record<string, unknown>, @Param('jobId') jobId: string, @Body() dto: RunJobDto) {
    await this.accessContextService.requireOperator(headers);
    return this.executionService.runJob(jobId, dto);
  }

  @Post('leads/:leadId/run-first-send-now')
  async runImmediateFirstSend(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.executionService.runImmediateSendForLead(leadId, { jobType: JobType.FIRST_SEND });
  }

  @Post('leads/:leadId/run-follow-up-now')
  async runImmediateFollowUp(
    @Headers() headers: Record<string, unknown>,
    @Param('leadId') leadId: string,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.executionService.runImmediateSendForLead(leadId, { jobType: JobType.FOLLOWUP_SEND });
  }
}
