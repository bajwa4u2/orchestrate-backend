import { Injectable } from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
  ) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.reminderArtifact.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, invoice: true, agreement: true },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(organizationId: string, createdById: string | undefined, dto: CreateReminderDto) {
    const reminder = await this.prisma.reminderArtifact.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        createdById,
        kind: dto.kind,
        status: dto.status ?? 'PENDING',
        invoiceId: dto.invoiceId,
        agreementId: dto.agreementId,
        dueAt: dto.dueAt,
        scheduledAt: dto.scheduledAt,
        subjectLine: dto.subjectLine,
        bodyText: dto.bodyText,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
      include: { client: true, invoice: true, agreement: true },
    });

    if (reminder.status === 'SENT' || reminder.scheduledAt) {
      await this.sendReminderEmail(organizationId, reminder);
    }

    return reminder;
  }

  private async sendReminderEmail(
    organizationId: string,
    reminder: { clientId: string; kind: string; subjectLine?: string | null; bodyText?: string | null; dueAt?: Date | null },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, reminder.clientId);
    if (!recipient?.email) return;

    const emailEvent = this.resolveReminderEvent(reminder.kind);

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent,
        toEmail: recipient.email,
        toName: recipient.name,
        subject: reminder.subjectLine?.trim() || this.defaultSubjectForEvent(emailEvent),
        bodyText: [
          reminder.bodyText?.trim() || this.defaultBodyForEvent(emailEvent, reminder.dueAt),
          `Orchestrate is a product of Aura Platform LLC.`,
        ].filter(Boolean).join('\n\n'),
      });
    } catch (error) {
      console.warn('[reminders] Failed to send reminder email', {
        organizationId,
        clientId: reminder.clientId,
        kind: reminder.kind,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private resolveReminderEvent(kind: string) {
    switch (kind) {
      case 'PAYMENT_DUE':
        return 'invoice_payment_due_reminder' as const;
      case 'PAYMENT_OVERDUE':
        return 'invoice_payment_overdue_reminder' as const;
      case 'STATEMENT_READY':
        return 'statement_ready_reminder' as const;
      case 'AGREEMENT_SIGNATURE':
        return 'agreement_signature_request' as const;
      case 'SERVICE_FOLLOW_UP':
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
