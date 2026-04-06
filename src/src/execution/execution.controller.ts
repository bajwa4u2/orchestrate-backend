import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { DispatchDueJobsDto } from './dto/dispatch-due-jobs.dto';
import { QueueLeadSendDto } from './dto/queue-lead-send.dto';
import { RunJobDto } from './dto/run-job.dto';
import { ExecutionService } from './execution.service';

@Controller('execution')
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  @Post('leads/:leadId/queue-first-send')
  queueLeadFirstSend(@Param('leadId') leadId: string, @Body() dto: QueueLeadSendDto) {
    return this.executionService.queueLeadSend(leadId, {
      ...dto,
      jobType: 'FIRST_SEND',
    });
  }

  @Post('leads/:leadId/queue-follow-up')
  queueLeadFollowUp(@Param('leadId') leadId: string, @Body() dto: QueueLeadSendDto) {
    return this.executionService.queueLeadSend(leadId, {
      ...dto,
      jobType: 'FOLLOWUP_SEND',
    });
  }

  @Post('dispatch-due')
  dispatchDue(@Body() dto: DispatchDueJobsDto, @Query('organizationId') organizationId?: string) {
    return this.executionService.dispatchDueJobs({
      ...dto,
      organizationId,
    });
  }

  @Post('jobs/:jobId/run')
  runJob(@Param('jobId') jobId: string, @Body() dto: RunJobDto) {
    return this.executionService.runJob(jobId, dto);
  }
}
