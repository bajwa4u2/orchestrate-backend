import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
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

  constructor(
    public readonly leadImportWorker: LeadImportWorkerService,
    public readonly messageGenerationWorker: MessageGenerationWorkerService,
    public readonly firstSendWorker: FirstSendWorkerService,
    public readonly followUpWorker: FollowUpWorkerService,
    public readonly replyClassificationWorker: ReplyClassificationWorkerService,
    public readonly meetingHandoffWorker: MeetingHandoffWorkerService,
    public readonly inboxSyncWorker: InboxSyncWorkerService,
    public readonly enrichmentWorker: EnrichmentWorkerService,
    public readonly scoringWorker: ScoringWorkerService,
    public readonly alertGenerationWorker: AlertGenerationWorkerService,
    public readonly invoiceGenerationWorker: InvoiceGenerationWorkerService,
  ) {
    this.register(this.leadImportWorker);
    this.register(this.messageGenerationWorker);
    this.register(this.firstSendWorker);
    this.register(this.followUpWorker);
    this.register(this.replyClassificationWorker);
    this.register(this.meetingHandoffWorker);
    this.register(this.inboxSyncWorker);
    this.register(this.enrichmentWorker);
    this.register(this.scoringWorker);
    this.register(this.alertGenerationWorker);
    this.register(this.invoiceGenerationWorker);
  }

  onModuleInit() {
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
