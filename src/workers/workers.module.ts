import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { EmailsModule } from '../emails/emails.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AlertGenerationWorkerModule } from './alert_generation/alert-generation.worker.module';
import { EnrichmentWorkerModule } from './enrichment/enrichment.worker.module';
import { FirstSendWorkerModule } from './first_send/first-send.worker.module';
import { FollowUpWorkerModule } from './follow_up/follow-up.worker.module';
import { InboxSyncWorkerModule } from './inbox_sync/inbox-sync.worker.module';
import { InvoiceGenerationWorkerModule } from './invoice_generation/invoice-generation.worker.module';
import { LeadImportWorkerModule } from './lead_import/lead-import.worker.module';
import { MeetingHandoffWorkerModule } from './meeting_handoff/meeting-handoff.worker.module';
import { MessageGenerationWorkerModule } from './message_generation/message-generation.worker.module';
import { ReplyClassificationWorkerModule } from './reply_classification/reply-classification.worker.module';
import { ScoringWorkerModule } from './scoring/scoring.worker.module';
import { WorkersService } from './workers.service';

@Module({
  imports: [
    DatabaseModule,
    WorkflowsModule,
    AiModule,
    forwardRef(() => DeliverabilityModule),
    forwardRef(() => EmailsModule),
    AlertGenerationWorkerModule,
    EnrichmentWorkerModule,
    FirstSendWorkerModule,
    FollowUpWorkerModule,
    InboxSyncWorkerModule,
    InvoiceGenerationWorkerModule,
    LeadImportWorkerModule,
    MeetingHandoffWorkerModule,
    MessageGenerationWorkerModule,
    ReplyClassificationWorkerModule,
    ScoringWorkerModule,
  ],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
