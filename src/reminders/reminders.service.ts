import { Injectable } from '@nestjs/common';
import {
  ActivityKind,
  ActivityVisibility,
  ArtifactLifecycle,
  RecordSource,
  ReminderArtifactKind,
  ReminderArtifactStatus,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.reminderArtifact.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, invoice: true, agreement: true },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(organizationId: string, createdById: string | undefined, dto: CreateReminderDto) {
    const trigger = dto.scheduledAt ? WorkflowTrigger.SCHEDULED : createdById ? WorkflowTrigger.MANUAL_OPERATOR : WorkflowTrigger.SYSTEM_EVENT;
    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: dto.clientId,
      invoiceId: dto.invoiceId ?? undefined,
      serviceAgreementId: dto.agreementId ?? undefined,
      lane: WorkflowLane.COMMUNICATIONS,
      type: WorkflowType.REMINDER_DISPATCH,
      status: WorkflowStatus.RUNNING,
      trigger,
      source: RecordSource.SYSTEM_GENERATED,
      title: `Reminder ${dto.kind}`,
      inputJson: {
        kind: dto.kind,
        dueAt: dto.dueAt?.toISOString() ?? null,
        scheduledAt: dto.scheduledAt?.toISOString() ?? null,
      },
      startedAt: new Date(),
    });

    const reminder = await this.prisma.reminderArtifact.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        createdById,
        invoiceId: dto.invoiceId,
        agreementId: dto.agreementId,
        workflowRunId: workflow.id,
        kind: dto.kind,
        status: dto.status ?? ReminderArtifactStatus.PENDING,
        source: RecordSource.SYSTEM_GENERATED,
        lifecycle: dto.status === ReminderArtifactStatus.SENT ? ArtifactLifecycle.DISPATCHED : ArtifactLifecycle.DRAFT,
        dueAt: dto.dueAt,
        scheduledAt: dto.scheduledAt,
        sentAt: dto.status === ReminderArtifactStatus.SENT ? new Date() : undefined,
        subjectLine: dto.subjectLine,
        bodyText: dto.bodyText,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
      include: { client: true, invoice: true, agreement: true },
    });

    let deliveryResult: { mode?: string } | null = null;
    if (reminder.status === ReminderArtifactStatus.SENT || reminder.scheduledAt) {
      deliveryResult = await this.sendReminderEmail(organizationId, reminder, workflow.id);
    }

    await Promise.all([
      this.workflowsService.completeWorkflowRun(workflow.id, {
        reminderId: reminder.id,
        reminderKind: reminder.kind,
        status: reminder.status,
        deliveryMode: deliveryResult?.mode ?? null,
      }),
      this.prisma.activityEvent.create({
        data: {
          organizationId,
          clientId: dto.clientId,
          actorUserId: createdById,
          workflowRunId: workflow.id,
          kind: ActivityKind.SYSTEM_ALERT,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'REMINDER',
          subjectId: reminder.id,
          summary: this.buildReminderSummary(reminder.kind, reminder.status),
          metadataJson: toPrismaJson({ kind: reminder.kind, status: reminder.status, dueAt: reminder.dueAt?.toISOString() ?? null }),
        },
      }),
    ]);

    return reminder;
  }

  private async sendReminderEmail(
    organizationId: string,
    reminder: { id: string; clientId: string; kind: ReminderArtifactKind; subjectLine?: string | null; bodyText?: string | null; dueAt?: Date | null },
    workflowRunId: string,
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, reminder.clientId);
    if (!recipient?.email) return null;

    const emailEvent = this.resolveReminderEvent(reminder.kind);

    try {
      const transport = await this.emailsService.sendDirectEmail({
        emailEvent,
        toEmail: recipient.email,
        toName: recipient.name,
        subject: reminder.subjectLine?.trim() || this.defaultSubjectForEvent(emailEvent),
        bodyText: [
          reminder.bodyText?.trim() || this.defaultBodyForEvent(emailEvent, reminder.dueAt),
          `Orchestrate is a product of Aura Platform LLC.`,
        ].filter(Boolean).join('\n\n'),
      });

      await this.prisma.reminderArtifact.update({
        where: { id: reminder.id },
        data: {
          status: ReminderArtifactStatus.SENT,
          sentAt: new Date(),
          lifecycle: ArtifactLifecycle.DISPATCHED,
        },
      });

      return { mode: transport.mode };
    } catch (error) {
      await this.workflowsService.markWorkflowWaiting(workflowRunId, {
        reminderId: reminder.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn('[reminders] Failed to send reminder email', {
        organizationId,
        clientId: reminder.clientId,
        kind: reminder.kind,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  private buildReminderSummary(kind: ReminderArtifactKind, status: ReminderArtifactStatus) {
    const prefix = status === ReminderArtifactStatus.SENT ? 'Reminder sent' : 'Reminder prepared';
    switch (kind) {
      case ReminderArtifactKind.PAYMENT_DUE:
        return `${prefix}: payment due notice.`;
      case ReminderArtifactKind.PAYMENT_OVERDUE:
        return `${prefix}: overdue payment notice.`;
      case ReminderArtifactKind.STATEMENT_READY:
        return `${prefix}: statement ready.`;
      case ReminderArtifactKind.AGREEMENT_SIGNATURE:
        return `${prefix}: agreement signature request.`;
      case ReminderArtifactKind.SERVICE_FOLLOW_UP:
      default:
        return `${prefix}: service follow-up.`;
    }
  }

  private resolveReminderEvent(kind: ReminderArtifactKind) {
    switch (kind) {
      case ReminderArtifactKind.PAYMENT_DUE:
        return 'invoice_payment_due_reminder' as const;
      case ReminderArtifactKind.PAYMENT_OVERDUE:
        return 'invoice_payment_overdue_reminder' as const;
      case ReminderArtifactKind.STATEMENT_READY:
        return 'statement_ready_reminder' as const;
      case ReminderArtifactKind.AGREEMENT_SIGNATURE:
        return 'agreement_signature_request' as const;
      case ReminderArtifactKind.SERVICE_FOLLOW_UP:
      default:
        return 'service_setup_reminder' as const;
    }
  }

  private defaultSubjectForEvent(event: string) {
    switch (event) {
      case 'invoice_payment_due_reminder':
        return 'Payment reminder from Orchestrate';
      case 'invoice_payment_overdue_reminder':
        return 'Overdue payment notice from Orchestrate';
      case 'statement_ready_reminder':
        return 'Your statement is ready';
      case 'agreement_signature_request':
        return 'Agreement signature requested';
      default:
        return 'Reminder from Orchestrate';
    }
  }

  private defaultBodyForEvent(event: string, dueAt?: Date | null) {
    switch (event) {
      case 'invoice_payment_due_reminder':
        return dueAt
          ? `This is a reminder that payment is due on ${dueAt.toISOString()}.`
          : 'This is a reminder that payment is due.';
      case 'invoice_payment_overdue_reminder':
        return 'This is a reminder that payment is now overdue.';
      case 'statement_ready_reminder':
        return 'Your latest statement is ready.';
      case 'agreement_signature_request':
        return 'Your agreement is ready for signature.';
      default:
        return 'There is an update that needs your attention.';
    }
  }
}
