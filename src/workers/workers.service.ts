import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Job, JobType } from '@prisma/client';
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
  private readonly logger = new Logger(WorkersService.name);
  private readonly registry = new Map<JobType, JobWorker>();

  constructor(private readonly moduleRef: ModuleRef) {}

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

    this.logger.log(
      `Running job ${job.id} type=${job.type} status=${job.status} via ${workerName}`,
    );

    try {
      const result = await worker.run(job, context);

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
}