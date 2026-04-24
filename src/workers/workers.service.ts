import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Job, JobType } from '@prisma/client';
import { AiDecisionEnforcementService } from '../ai/governance/ai-decision-enforcement.service';
import { AlertGenerationWorkerService } from './alert_generation/alert-generation.worker.service';
import { EnrichmentWorkerService } from './enrichment/enrichment.worker.service';
import { FirstSendWorkerService } from './first_send/first-send.worker.service';
import { FollowUpWorkerService } from './follow_up/follow-up.worker.service';
import { InboxSyncWorkerService } from './inbox_sync/inbox-sync.worker.service';
import { InvoiceGenerationWorkerService } from './invoice_generation/invoice-generation.worker.service';
import { LeadImportWorkerService } from './lead_import/lead-import.worker.service';
import { MeetingHandoffWorkerService } from './meeting_handoff/meeting-handoff.worker.service';
import { MessageGenerationWorkerService } from './message_generation/message-generation.worker.service';
import { ReplyClassificationWorkerService } from './reply_classification/reply-classification.worker.service';
import { ScoringWorkerService } from './scoring/scoring.worker.service';
import { JobWorker, WorkerContext } from './worker.types';

@Injectable()
export class WorkersService implements OnModuleInit {
  private static readonly GOVERNED_EXECUTION_JOB_TYPES = new Set<JobType>([
    JobType.LEAD_IMPORT,
    JobType.MESSAGE_GENERATION,
    JobType.FIRST_SEND,
    JobType.FOLLOWUP_SEND,
    JobType.REPLY_CLASSIFICATION,
    JobType.MEETING_HANDOFF,
  ]);

  private readonly logger = new Logger(WorkersService.name);
  private readonly registry = new Map<JobType, JobWorker>();

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly decisionEnforcement: AiDecisionEnforcementService,
  ) {}

  onModuleInit() {
    const workerTypes: Array<Type<JobWorker>> = [
      LeadImportWorkerService,
      MessageGenerationWorkerService,
      FirstSendWorkerService,
      FollowUpWorkerService,
      ReplyClassificationWorkerService,
      MeetingHandoffWorkerService,
      InboxSyncWorkerService,
      EnrichmentWorkerService,
      ScoringWorkerService,
      AlertGenerationWorkerService,
      InvoiceGenerationWorkerService,
    ];

    for (const workerType of workerTypes) {
      const worker = this.moduleRef.get(workerType, { strict: false });
      if (!worker) {
        throw new Error(`Worker provider unavailable: ${workerType.name}`);
      }
      this.register(worker);
    }

    const expectedJobTypes: JobType[] = [
      JobType.LEAD_IMPORT,
      JobType.LEAD_ENRICHMENT,
      JobType.LEAD_SCORING,
      JobType.MESSAGE_GENERATION,
      JobType.FIRST_SEND,
      JobType.FOLLOWUP_SEND,
      JobType.INBOX_SYNC,
      JobType.REPLY_CLASSIFICATION,
      JobType.MEETING_HANDOFF,
      JobType.INVOICE_GENERATION,
      JobType.ALERT_EVALUATION,
    ];

    const missing = expectedJobTypes.filter((jobType) => !this.registry.has(jobType));
    if (missing.length) {
      throw new Error(`Missing worker registrations: ${missing.join(', ')}`);
    }

    this.logger.log(
      `Workers registry ready for job types: ${Array.from(this.registry.keys()).join(', ')}`,
    );
  }

  async run(job: Job, context: WorkerContext) {
    const worker = this.registry.get(job.type);

    if (!worker) {
      this.logger.error(
        `No worker registered for job type ${job.type} (jobId=${job.id})`,
      );
      throw new BadRequestException(`No worker registered for job type ${job.type}`);
    }

    const workerName = (worker as object).constructor?.name ?? 'UnknownWorker';

    if (this.isGovernedExecutionJobType(job.type)) {
      const governance = this.resolveGovernance(job, context);
      const enforcement = await this.decisionEnforcement.enforce({
        decisionId: job.aiDecisionId,
        organizationId: job.organizationId,
        scope: governance.scope,
        action: governance.action,
        entity: governance.entity,
        serviceName: WorkersService.name,
        methodName: 'run',
        entityType: governance.entityType,
        entityId: governance.entityId,
        operation: 'RUN',
        workflowRunId: context.workflowRunId ?? governance.entity.workflowRunId ?? null,
        jobId: job.id,
        metadata: {
          workerName,
          jobType: job.type,
          queueName: job.queueName,
        },
      });

      if (!enforcement.allowed) {
        this.logger.error(
          `AI governance blocked job ${job.id} type=${job.type} via ${workerName}: ${enforcement.reason}`,
        );
        throw new BadRequestException(enforcement.reason);
      }
    }

    this.logger.log(
      `Running job ${job.id} type=${job.type} status=${job.status} via ${workerName}`,
    );

    try {
      const result = await worker.run(job, { ...context, aiDecisionId: job.aiDecisionId ?? context.aiDecisionId });

      this.logger.log(
        `Completed job ${job.id} type=${job.type} via ${workerName}`,
      );

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown worker execution error';

      this.logger.error(
        `Worker failed for job ${job.id} type=${job.type} via ${workerName}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }

  private register(worker: JobWorker) {
    const workerName = (worker as object).constructor?.name ?? 'UnknownWorker';

    if (!Array.isArray(worker.jobTypes) || worker.jobTypes.length === 0) {
      throw new Error(`Worker ${workerName} has no jobTypes defined`);
    }

    for (const jobType of worker.jobTypes) {
      this.registry.set(jobType, worker);
      this.logger.log(`Registered ${workerName} for ${jobType}`);
    }
  }

  private isGovernedExecutionJobType(jobType: JobType) {
    return WorkersService.GOVERNED_EXECUTION_JOB_TYPES.has(jobType);
  }

  private resolveGovernance(job: Job, context: WorkerContext) {
    const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
    const readString = (value: unknown) =>
      typeof value === 'string' && value.trim().length ? value.trim() : null;

    const leadId = readString(payload.leadId);
    const replyId = readString(payload.replyId);
    const workflowRunId = context.workflowRunId ?? readString(payload.workflowRunId);
    const intendedJobType = readString(payload.jobType);

    switch (job.type) {
      case JobType.LEAD_IMPORT:
        return {
          scope: 'CAMPAIGN' as const,
          action: 'SOURCE_LEADS' as const,
          entityType: 'campaign',
          entityId: job.campaignId ?? readString(payload.campaignId) ?? job.id,
          entity: {
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId ?? readString(payload.campaignId),
            workflowRunId,
            jobId: job.id,
          },
        };
      case JobType.MESSAGE_GENERATION:
        return {
          scope: 'LEAD' as const,
          action: intendedJobType === JobType.FOLLOWUP_SEND ? ('SEND_FOLLOW_UP' as const) : ('SEND_FIRST_OUTREACH' as const),
          entityType: 'lead',
          entityId: leadId ?? job.id,
          entity: {
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId,
            leadId,
            workflowRunId,
            jobId: job.id,
          },
        };
      case JobType.FOLLOWUP_SEND:
        return {
          scope: 'LEAD' as const,
          action: 'SEND_FOLLOW_UP' as const,
          entityType: 'lead',
          entityId: leadId ?? job.id,
          entity: {
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId,
            leadId,
            workflowRunId,
            jobId: job.id,
          },
        };
      case JobType.REPLY_CLASSIFICATION:
        return {
          scope: 'REPLY' as const,
          action: 'PROCESS_REPLY' as const,
          entityType: 'reply',
          entityId: replyId ?? job.id,
          entity: {
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId,
            replyId,
            workflowRunId,
            jobId: job.id,
          },
        };
      case JobType.MEETING_HANDOFF:
        return {
          scope: 'REPLY' as const,
          action: 'HANDOFF_MEETING' as const,
          entityType: 'reply',
          entityId: replyId ?? job.id,
          entity: {
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId,
            replyId,
            workflowRunId,
            jobId: job.id,
          },
        };
      case JobType.FIRST_SEND:
      default:
        return {
          scope: 'LEAD' as const,
          action: 'SEND_FIRST_OUTREACH' as const,
          entityType: 'lead',
          entityId: leadId ?? job.id,
          entity: {
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId,
            leadId,
            workflowRunId,
            jobId: job.id,
          },
        };
    }
  }
}
