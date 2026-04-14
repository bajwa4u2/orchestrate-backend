import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  ActivityVisibility,
  JobStatus,
  JobType,
  RecordSource,
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
        externalMessageId: input.externalMessageId ?? null,
      },
      startedAt: new Date(),
    });

    const existingReply = await this.prisma.reply.findFirst({
      where: {
        messageId: matchedMessage.id,
        fromEmail,
        receivedAt: this.resolveReceivedAt(input.receivedAt),
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
        receivedAt: this.resolveReceivedAt(input.receivedAt),
        metadataJson: toPrismaJson({
          externalMessageId: input.externalMessageId ?? null,
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
    return this.prisma.reply.findMany({
      where: { clientId },
      include: {
        lead: true,
        campaign: true,
        message: true,
        meeting: true,
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async resolveMatchedOutboundMessage(input: InboundReplyInput, fromEmail: string) {
    const mailboxEmail = input.mailboxEmail?.trim().toLowerCase();
    const externalMessageId = input.externalMessageId?.trim();
    const threadKey = input.threadKey?.trim();

    if (externalMessageId) {
      const byExternal = await this.prisma.outreachMessage.findFirst({
        where: {
          externalMessageId,
          direction: 'OUTBOUND',
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
      if (byExternal) return byExternal;
    }

    if (threadKey) {
      const byThread = await this.prisma.outreachMessage.findFirst({
        where: {
          threadKey,
          direction: 'OUTBOUND',
          lead: {
            contact: {
              email: fromEmail,
            },
          },
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
      if (byThread) return byThread;
    }

    return this.prisma.outreachMessage.findFirst({
      where: {
        direction: 'OUTBOUND',
        ...(mailboxEmail
          ? {
              mailbox: {
                emailAddress: mailboxEmail,
              },
            }
          : {}),
        lead: {
          contact: {
            email: fromEmail,
          },
        },
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
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }
}