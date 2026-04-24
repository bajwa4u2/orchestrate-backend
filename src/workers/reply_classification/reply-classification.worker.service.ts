import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityVisibility,
  Job,
  JobStatus,
  JobType,
  LeadQualificationState,
  LeadStatus,
  Prisma,
  ReplyIntent,
} from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { AiDecisionEnforcementService } from '../../ai/governance/ai-decision-enforcement.service';
import { AiDecisionGatewayService } from '../../ai/governance/ai-decision-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class ReplyClassificationWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.REPLY_CLASSIFICATION];

  constructor(
    private readonly prisma: PrismaService,
    private readonly decisionGateway: AiDecisionGatewayService,
    private readonly decisionEnforcement: AiDecisionEnforcementService,
  ) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const replyId = this.readString(context.payload.replyId);
    if (!replyId) {
      throw new BadRequestException(`Job ${job.id} is missing replyId`);
    }

    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      include: {
        lead: { include: { contact: true, account: true } },
      },
    });
    if (!reply) {
      throw new NotFoundException(`Reply ${replyId} not found`);
    }

    const classification = this.classifyReplyIntent({
      subjectLine: reply.subjectLine,
      bodyText: reply.bodyText,
    });

    const updatedReply = await this.prisma.reply.update({
      where: { id: reply.id },
      data: {
        workflowRunId: context.workflowRunId,
        intent: classification.intent,
        confidence: new Prisma.Decimal(classification.confidence.toFixed(2)),
        requiresHumanReview: classification.requiresHumanReview,
        handledAt:
          classification.intent === ReplyIntent.INTERESTED ||
          classification.intent === ReplyIntent.REFERRAL ||
          classification.intent === ReplyIntent.UNSUBSCRIBE ||
          classification.intent === ReplyIntent.NOT_NOW ||
          classification.intent === ReplyIntent.NOT_RELEVANT
            ? new Date()
            : null,
        metadataJson: toPrismaJson({
          ...(this.asObject(reply.metadataJson) as Record<string, unknown>),
          classification: {
            intent: classification.intent,
            confidence: classification.confidence,
            requiresHumanReview: classification.requiresHumanReview,
            matchedSignals: classification.matchedSignals,
            classifiedAt: new Date().toISOString(),
          },
        }),
      },
    });

    let nextLeadStatus: LeadStatus | null = null;
    let nextQualification: LeadQualificationState | null = null;
    if (classification.intent === ReplyIntent.INTERESTED || classification.intent === ReplyIntent.REFERRAL) {
      nextLeadStatus = LeadStatus.INTERESTED;
      nextQualification = LeadQualificationState.INTERESTED;
    } else if (classification.intent === ReplyIntent.NOT_NOW || classification.intent === ReplyIntent.NOT_RELEVANT) {
      nextLeadStatus = LeadStatus.REPLIED;
      nextQualification = LeadQualificationState.REPLIED;
    } else if (classification.intent === ReplyIntent.UNSUBSCRIBE) {
      nextLeadStatus = LeadStatus.SUPPRESSED;
      nextQualification = LeadQualificationState.DISQUALIFIED;
    } else if (classification.intent === ReplyIntent.OOO || classification.intent === ReplyIntent.UNCLEAR) {
      nextLeadStatus = LeadStatus.REPLIED;
      nextQualification = LeadQualificationState.REPLIED;
    }

    if (nextLeadStatus && nextQualification) {
      await this.prisma.lead.update({
        where: { id: reply.leadId },
        data: {
          status: nextLeadStatus,
          qualificationState: nextQualification,
          lastContactAt: new Date(),
          suppressionReason: classification.intent === ReplyIntent.UNSUBSCRIBE ? 'unsubscribe_reply' : undefined,
        },
      });
    }

    await this.prisma.activityEvent.create({
      data: {
        organizationId: reply.organizationId,
        clientId: reply.clientId,
        campaignId: reply.campaignId,
        workflowRunId: context.workflowRunId,
        kind: 'REPLY_RECEIVED',
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'reply',
        subjectId: reply.id,
        summary: `Reply classified as ${classification.intent.toLowerCase()}`,
        metadataJson: toPrismaJson({
          replyId: reply.id,
          intent: classification.intent,
          confidence: classification.confidence,
          requiresHumanReview: classification.requiresHumanReview,
        }),
      },
    });

    let handoffJobId: string | null = null;
    if (classification.intent === ReplyIntent.INTERESTED || classification.intent === ReplyIntent.REFERRAL) {
      const dedupeKey = `meeting_handoff:${reply.id}`;
      const existingJob = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED] },
        },
        select: { id: true },
      });

      if (!existingJob) {
        const governance = await this.decisionGateway.decide({
          scope: 'REPLY',
          entity: {
            organizationId: reply.organizationId,
            clientId: reply.clientId,
            campaignId: reply.campaignId,
            replyId: reply.id,
            workflowRunId: context.workflowRunId ?? null,
            jobId: job.id,
          },
          preferredAction: 'HANDOFF_MEETING',
          proposedJobType: JobType.MEETING_HANDOFF,
          source: {
            layer: 'worker',
            service: ReplyClassificationWorkerService.name,
            method: 'run',
            worker: ReplyClassificationWorkerService.name,
            reason: 'queue_meeting_handoff_from_reply_classification',
          },
          enforcement: {
            entityType: 'reply',
            entityId: reply.id,
            operation: 'QUEUE',
            workflowRunId: context.workflowRunId ?? null,
            jobId: job.id,
          },
        });

        const enforcement = await this.decisionEnforcement.enforce({
          decisionId: governance.decisionId,
          organizationId: reply.organizationId,
          scope: 'REPLY',
          action: 'HANDOFF_MEETING',
          entity: governance.snapshot.entity,
          serviceName: ReplyClassificationWorkerService.name,
          methodName: 'run',
          entityType: 'reply',
          entityId: reply.id,
          operation: 'QUEUE',
          workflowRunId: context.workflowRunId ?? null,
          jobId: job.id,
          metadata: {
            queueName: 'meetings',
          },
        });

        if (!enforcement.allowed || !governance.decisionId) {
          throw new BadRequestException(enforcement.reason || `AI governance blocked meeting handoff queue for ${reply.id}`);
        }

        const handoffJob = await this.prisma.job.create({
          data: {
            organizationId: reply.organizationId,
            clientId: reply.clientId,
            campaignId: reply.campaignId,
            aiDecisionId: governance.decisionId,
            type: JobType.MEETING_HANDOFF,
            status: JobStatus.QUEUED,
            queueName: 'meetings',
            dedupeKey,
            scheduledFor: new Date(),
            maxAttempts: 3,
            payloadJson: toPrismaJson({
              replyId: reply.id,
              workflowRunId: context.workflowRunId,
              aiDecisionId: governance.decisionId,
            }),
          },
        });
        handoffJobId = handoffJob.id;
      } else {
        handoffJobId = existingJob.id;
      }
    }

    return {
      ok: true,
      replyId: reply.id,
      intent: updatedReply.intent,
      confidence: classification.confidence,
      requiresHumanReview: classification.requiresHumanReview,
      handoffJobId,
      workflowRunId: context.workflowRunId,
      jobId: job.id,
    };
  }

  private classifyReplyIntent(input: { subjectLine?: string | null; bodyText?: string | null }) {
    const subject = (input.subjectLine || '').toLowerCase();
    const body = (input.bodyText || '').toLowerCase();
    const text = `${subject}\n${body}`;
    const signals: string[] = [];

    const has = (phrases: string[]) => {
      const match = phrases.find((phrase) => text.includes(phrase));
      if (match) signals.push(match);
      return Boolean(match);
    };

    if (has(['unsubscribe', 'remove me', 'stop emailing', 'do not contact', "don't contact"])) {
      return { intent: ReplyIntent.UNSUBSCRIBE, confidence: 0.99, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['out of office', 'ooo', 'automatic reply', 'auto-reply'])) {
      return { intent: ReplyIntent.OOO, confidence: 0.94, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['not relevant', 'not a fit', 'no interest', 'not interested', 'not for us'])) {
      return { intent: ReplyIntent.NOT_RELEVANT, confidence: 0.93, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['circle back', 'next quarter', 'next month', 'later this year', 'not right now', 'not now'])) {
      return { intent: ReplyIntent.NOT_NOW, confidence: 0.9, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['talk next week', 'book a call', 'schedule a call', "let's meet", 'lets meet', 'interested', 'sounds good', 'happy to chat', 'send me your calendar', 'book time'])) {
      return { intent: ReplyIntent.INTERESTED, confidence: 0.95, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['reach out to', 'contact', 'speak with', 'forwarding you to', 'cc ', 'looping in'])) {
      return { intent: ReplyIntent.REFERRAL, confidence: 0.82, requiresHumanReview: false, matchedSignals: signals };
    }
    if (!body.trim()) {
      return { intent: ReplyIntent.HUMAN_REVIEW, confidence: 0.4, requiresHumanReview: true, matchedSignals: signals };
    }
    return { intent: ReplyIntent.UNCLEAR, confidence: 0.55, requiresHumanReview: true, matchedSignals: signals };
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }
}
