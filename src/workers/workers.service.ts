import { BadRequestException, Injectable, OnModuleInit, Type } from '@nestjs/common';
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
  }

  async run(job: Job, context: WorkerContext) {
    const worker = this.registry.get(job.type);
    if (!worker) {
      throw new BadRequestException(`No worker registered for job type ${job.type}`);
    }

    return worker.run(job, context);
  }

  private register(worker: JobWorker) {
    for (const jobType of worker.jobTypes) {
      this.registry.set(jobType, worker);
    }
  }
}