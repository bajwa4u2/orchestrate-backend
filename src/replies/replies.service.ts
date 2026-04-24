import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  ActivityVisibility,
  CommunicationType,
  ContactConsentStatus,
  JobStatus,
  JobType,
  RecordSource,
  SuppressionType,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { ExecutionService } from '../execution/execution.service';

type InboundReplyInput = {
  mailboxEmail?: string;
  fromEmail: string;
  subjectLine?: string;
  bodyText?: string;
  externalMessageId?: string;
  providerThreadId?: string;
  threadKey?: string;
  receivedAt?: string | Date;
};

@Injectable()
export class RepliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowsService: WorkflowsService,
    @Inject(forwardRef(() => ExecutionService))
    private readonly executionService: ExecutionService,
  ) {}

  async ingestInboundReply(input: InboundReplyInput) {
    const fromEmail = input.fromEmail?.trim().toLowerCase();
    if (!fromEmail) {
      throw new BadRequestException('fromEmail is required');
    }

    const matchedMessage = await this.resolveMatchedOutboundMessage(input, fromEmail);
    if (!matchedMessage) {
      throw new NotFoundException('No matching outbound message was found for this reply');
    }

    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: matchedMessage.clientId,
      campaignId: matchedMessage.campaignId,
      lane: WorkflowLane.GROWTH,
      type: WorkflowType.REPLY_PROCESSING,
      status: WorkflowStatus.RUNNING,
      trigger: WorkflowTrigger.SYSTEM_EVENT,
      source: RecordSource.EXTERNAL_SYNC,
      title: `Inbound reply from ${fromEmail}`,
      inputJson: {
        fromEmail,
        messageId: matchedMessage.id,
        threadKey: input.threadKey ?? null,
        providerThreadId: input.providerThreadId ?? null,
        externalMessageId: input.externalMessageId ?? null,
      },
      startedAt: new Date(),
    });

    const receivedAt = this.resolveReceivedAt(input.receivedAt);
    const existingReply = await this.prisma.reply.findFirst({
      where: {
        messageId: matchedMessage.id,
        fromEmail,
        receivedAt,
      },
      select: { id: true },
    });

    if (existingReply) {
      await this.workflowsService.markWorkflowWaiting(workflow.id, {
        dedupedToReplyId: existingReply.id,
      });
      return {
        ok: true,
        deduped: true,
        replyId: existingReply.id,
        workflowRunId: workflow.id,
      };
    }

    const reply = await this.prisma.reply.create({
      data: {
        organizationId: matchedMessage.organizationId,
        clientId: matchedMessage.clientId,
        campaignId: matchedMessage.campaignId,
        leadId: matchedMessage.leadId,
        messageId: matchedMessage.id,
        mailboxId: matchedMessage.mailboxId,
        workflowRunId: workflow.id,
        source: RecordSource.EXTERNAL_SYNC,
        fromEmail,
        subjectLine: input.subjectLine?.trim() || null,
        bodyText: input.bodyText?.trim() || null,
        receivedAt,
        metadataJson: toPrismaJson({
          externalMessageId: input.externalMessageId ?? null,
          providerThreadId: input.providerThreadId ?? null,
          threadKey: input.threadKey ?? null,
          mailboxEmail: input.mailboxEmail?.trim().toLowerCase() ?? null,
          matchedOutboundMessageId: matchedMessage.id,
        }),
      },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: matchedMessage.organizationId,
        clientId: matchedMessage.clientId,
        campaignId: matchedMessage.campaignId,
        workflowRunId: workflow.id,
        kind: 'REPLY_RECEIVED',
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'reply',
        subjectId: reply.id,
        summary: `Inbound reply received from ${fromEmail}`,
        metadataJson: toPrismaJson({
          replyId: reply.id,
          messageId: matchedMessage.id,
          leadId: matchedMessage.leadId,
        }),
      },
    });

    const classificationJob = await this.prisma.job.create({
      data: {
        organizationId: matchedMessage.organizationId,
        clientId: matchedMessage.clientId,
        campaignId: matchedMessage.campaignId,
        type: JobType.REPLY_CLASSIFICATION,
        status: JobStatus.QUEUED,
        queueName: 'replies',
        dedupeKey: `reply_classification:${reply.id}`,
        scheduledFor: new Date(),
        maxAttempts: 3,
        payloadJson: toPrismaJson({
          replyId: reply.id,
          workflowRunId: workflow.id,
        }),
      },
    });

    await this.workflowsService.markWorkflowWaiting(workflow.id, {
      replyId: reply.id,
      classificationJobId: classificationJob.id,
    });

    return {
      ok: true,
      replyId: reply.id,
      workflowRunId: workflow.id,
      classificationJobId: classificationJob.id,
    };
  }

  async processReply(replyId: string) {
    const classification = await this.executionService.runReplyClassification(replyId);
    let handoff: Awaited<ReturnType<ExecutionService['runMeetingHandoff']>> | null = null;

    if (classification.intent === 'UNSUBSCRIBE') {
      await this.applyUnsubscribeForReply(replyId);
    }

    if (!classification.requiresHumanReview && classification.handoffJobId) {
      handoff = await this.executionService.runMeetingHandoff(replyId);
    }

    return {
      ok: true,
      classification,
      handoff,
    };
  }

  async listForClient(clientId: string) {
    const replies = await this.prisma.reply.findMany({
      where: { clientId },
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        campaignId: true,
        leadId: true,
        messageId: true,
        mailboxId: true,
        intent: true,
        source: true,
        confidence: true,
        fromEmail: true,
        subjectLine: true,
        bodyText: true,
        receivedAt: true,
        requiresHumanReview: true,
        handledAt: true,
        metadataJson: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    const organizationId = replies[0]?.organizationId;
    const leadIds = Array.from(new Set(replies.map((reply) => reply.leadId).filter(Boolean))) as string[];
    const campaignIds = Array.from(new Set(replies.map((reply) => reply.campaignId).filter(Boolean))) as string[];
    const messageIds = Array.from(new Set(replies.map((reply) => reply.messageId).filter(Boolean))) as string[];
    const replyIds = replies.map((reply) => reply.id);

    const [leads, campaigns, messages, meetings] = await Promise.all([
      organizationId && leadIds.length
        ? this.safeValue(() => this.prisma.lead.findMany({
            where: { organizationId, clientId, id: { in: leadIds } },
            select: {
              id: true,
              status: true,
              contact: { select: { id: true, fullName: true, email: true } },
            },
          }), [])
        : [],
      organizationId && campaignIds.length
        ? this.safeValue(() => this.prisma.campaign.findMany({
            where: { organizationId, clientId, id: { in: campaignIds } },
            select: { id: true, name: true, status: true },
          }), [])
        : [],
      organizationId && messageIds.length
        ? this.safeValue(() => this.prisma.outreachMessage.findMany({
            where: { organizationId, clientId, id: { in: messageIds } },
            select: { id: true, subjectLine: true, status: true, sentAt: true },
          }), [])
        : [],
      organizationId && replyIds.length
        ? this.safeValue(() => this.prisma.meeting.findMany({
            where: { organizationId, clientId, replyId: { in: replyIds } },
            select: { id: true, replyId: true, status: true, scheduledAt: true, title: true, bookingUrl: true },
          }), [])
        : [],
    ]);

    const leadsById = new Map((leads as any[]).map((item) => [item.id, item]));
    const campaignsById = new Map((campaigns as any[]).map((item) => [item.id, item]));
    const messagesById = new Map((messages as any[]).map((item) => [item.id, item]));
    const meetingsByReplyId = new Map((meetings as any[]).map((item) => [item.replyId, item]));

    return replies.map((reply) => ({
      ...reply,
      lead: leadsById.get(reply.leadId) ?? null,
      campaign: campaignsById.get(reply.campaignId) ?? null,
      message: reply.messageId ? messagesById.get(reply.messageId) ?? null : null,
      meeting: meetingsByReplyId.get(reply.id) ?? null,
    }));
  }

  private async safeValue<T>(loader: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await loader();
    } catch (error) {
      console.warn('[RepliesService] client reply relation query failed', error);
      return fallback;
    }
  }

  private async applyUnsubscribeForReply(replyId: string) {
    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      include: {
        lead: {
          include: {
            contact: { include: { contactChannels: { where: { type: 'EMAIL' }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } } },
          },
        },
      },
    });

    if (!reply?.lead?.contact) return;

    const contact = reply.lead.contact as any;
    const channels = Array.isArray((contact as any).contactChannels) ? (contact as any).contactChannels : [];
    const emailChannel = channels.find((item: any) => item.value?.toLowerCase() === reply.fromEmail?.toLowerCase()) ?? channels[0] ?? null;

    await this.prisma.contactConsent.upsert({
      where: {
        contactId_contactChannelId_communication: {
          contactId: contact.id,
          contactChannelId: emailChannel?.id ?? null,
          communication: CommunicationType.NEWSLETTER,
        },
      },
      update: {
        status: ContactConsentStatus.UNSUBSCRIBED,
        revokedAt: new Date(),
        reason: 'reply_unsubscribe',
        metadataJson: toPrismaJson({ replyId }),
      },
      create: {
        organizationId: reply.organizationId,
        clientId: reply.clientId,
        contactId: contact.id,
        contactChannelId: emailChannel?.id ?? undefined,
        communication: CommunicationType.NEWSLETTER,
        status: ContactConsentStatus.UNSUBSCRIBED,
        source: RecordSource.SYSTEM_GENERATED,
        sourceLabel: 'reply_unsubscribe',
        reason: 'reply_unsubscribe',
        revokedAt: new Date(),
        metadataJson: toPrismaJson({ replyId }),
      },
    });

    if (emailChannel) {
      await this.prisma.contactConsent.upsert({
        where: {
          contactId_contactChannelId_communication: {
            contactId: contact.id,
            contactChannelId: emailChannel.id,
            communication: CommunicationType.OUTREACH,
          },
        },
        update: {
          status: ContactConsentStatus.BLOCKED,
          revokedAt: new Date(),
          reason: 'reply_unsubscribe',
          metadataJson: toPrismaJson({ replyId }),
        },
        create: {
          organizationId: reply.organizationId,
          clientId: reply.clientId,
          contactId: contact.id,
          contactChannelId: emailChannel.id,
          communication: CommunicationType.OUTREACH,
          status: ContactConsentStatus.BLOCKED,
          source: RecordSource.SYSTEM_GENERATED,
          sourceLabel: 'reply_unsubscribe',
          reason: 'reply_unsubscribe',
          revokedAt: new Date(),
          metadataJson: toPrismaJson({ replyId }),
        },
      });
    }

    if (reply.fromEmail?.trim()) {
      const normalized = reply.fromEmail.trim().toLowerCase();
      const existingSuppression = await this.prisma.suppressionEntry.findFirst({
        where: {
          organizationId: reply.organizationId,
          type: SuppressionType.UNSUBSCRIBE,
          emailAddress: normalized,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingSuppression) {
        await this.prisma.suppressionEntry.update({
          where: { id: existingSuppression.id },
          data: {
            clientId: reply.clientId,
            contactId: contact?.id ?? existingSuppression.contactId,
            reason: 'reply_unsubscribe',
            source: 'reply_classification',
          },
        });
      } else {
        await this.prisma.suppressionEntry.create({
          data: {
            organizationId: reply.organizationId,
            clientId: reply.clientId,
            contactId: contact?.id ?? null,
            type: SuppressionType.UNSUBSCRIBE,
            emailAddress: normalized,
            reason: 'reply_unsubscribe',
            source: 'reply_classification',
          },
        });
      }
    }
  }

  private async resolveMatchedOutboundMessage(input: InboundReplyInput, fromEmail: string) {
    const mailboxEmail = input.mailboxEmail?.trim().toLowerCase();
    const externalMessageId = input.externalMessageId?.trim();
    const providerThreadId = input.providerThreadId?.trim();
    const threadKey = input.threadKey?.trim();

    if (providerThreadId) {
      const byInReplyTo = await this.prisma.outreachMessage.findFirst({
        where: {
          direction: 'OUTBOUND',
          externalMessageId: providerThreadId,
        },
        select: {
          id: true,
          organizationId: true,
          clientId: true,
          campaignId: true,
          leadId: true,
          mailboxId: true,
        },
      });
      if (byInReplyTo) return byInReplyTo;
    }

    if (threadKey) {
      const byThreadKey = await this.prisma.outreachMessage.findFirst({
        where: {
          direction: 'OUTBOUND',
          threadKey,
          lead: { contact: { email: fromEmail } },
        },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          organizationId: true,
          clientId: true,
          campaignId: true,
          leadId: true,
          mailboxId: true,
        },
      });
      if (byThreadKey) return byThreadKey;
    }

    if (externalMessageId) {
      const byExternalMessageId = await this.prisma.outreachMessage.findFirst({
        where: {
          direction: 'OUTBOUND',
          externalMessageId,
          lead: { contact: { email: fromEmail } },
        },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          organizationId: true,
          clientId: true,
          campaignId: true,
          leadId: true,
          mailboxId: true,
        },
      });
      if (byExternalMessageId) return byExternalMessageId;
    }

    const conditions: any[] = [
      { lead: { contact: { email: fromEmail } } },
      { lead: { contact: { is: { contactChannels: { some: { normalizedValue: fromEmail } } } } } },
    ];
    if (mailboxEmail) {
      conditions.push({ mailbox: { emailAddress: mailboxEmail } });
    }

    return this.prisma.outreachMessage.findFirst({
      where: {
        direction: 'OUTBOUND',
        OR: conditions,
      },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        campaignId: true,
        leadId: true,
        mailboxId: true,
      },
    });
  }

  private resolveReceivedAt(value?: string | Date) {
    if (!value) return new Date();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}
