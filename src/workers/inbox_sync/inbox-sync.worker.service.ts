import { BadRequestException, Injectable } from '@nestjs/common';
import { Job, JobStatus, JobType } from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { AiDecisionEnforcementService } from '../../ai/governance/ai-decision-enforcement.service';
import { AiDecisionGatewayService } from '../../ai/governance/ai-decision-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class InboxSyncWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.INBOX_SYNC];

  constructor(
    private readonly prisma: PrismaService,
    private readonly decisionGateway: AiDecisionGatewayService,
    private readonly decisionEnforcement: AiDecisionEnforcementService,
  ) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    return this.runMailboxSync({
      jobId: job.id,
      organizationId: job.organizationId,
      clientId: job.clientId ?? undefined,
      campaignId: this.readString(context.payload.campaignId) ?? job.campaignId ?? undefined,
    });
  }

  async runMailboxSync(input: { jobId?: string; clientId?: string; organizationId?: string; campaignId?: string } = {}) {
    const unmatchedReplies = await this.prisma.reply.findMany({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.campaignId ? { campaignId: input.campaignId } : {}),
        handledAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        campaignId: true,
        messageId: true,
        fromEmail: true,
        receivedAt: true,
      },
      orderBy: [{ receivedAt: 'desc' }],
      take: 50,
    });

    const queuedReplyJobIds: string[] = [];
    for (const reply of unmatchedReplies) {
      const dedupeKey = `reply_classification:${reply.id}`;
      const existing = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED] },
        },
        select: { id: true },
      });
      if (existing) continue;

      const governance = await this.decisionGateway.decide({
        scope: 'REPLY',
        entity: {
          organizationId: reply.organizationId,
          clientId: reply.clientId,
          campaignId: reply.campaignId,
          replyId: reply.id,
          workflowRunId: null,
          jobId: input.jobId ?? null,
        },
        preferredAction: 'PROCESS_REPLY',
        proposedJobType: JobType.REPLY_CLASSIFICATION,
        source: {
          layer: 'worker',
          service: InboxSyncWorkerService.name,
          method: 'runMailboxSync',
          worker: InboxSyncWorkerService.name,
          reason: 'queue_reply_classification_from_inbox_sync',
        },
        enforcement: {
          entityType: 'reply',
          entityId: reply.id,
          operation: 'QUEUE',
          jobId: input.jobId ?? null,
        },
        metadata: {
          sourceJobId: input.jobId ?? null,
        },
      });

      const enforcement = await this.decisionEnforcement.enforce({
        decisionId: governance.decisionId,
        organizationId: reply.organizationId,
        scope: 'REPLY',
        action: 'PROCESS_REPLY',
        entity: governance.snapshot.entity,
        serviceName: InboxSyncWorkerService.name,
        methodName: 'runMailboxSync',
        entityType: 'reply',
        entityId: reply.id,
        operation: 'QUEUE',
        jobId: input.jobId ?? null,
        metadata: {
          queueName: 'replies',
        },
      });

      if (!enforcement.allowed || !governance.decisionId) {
        throw new BadRequestException(enforcement.reason || `AI governance blocked reply classification for ${reply.id}`);
      }

      const created = await this.prisma.job.create({
        data: {
          organizationId: reply.organizationId,
          clientId: reply.clientId,
          campaignId: reply.campaignId,
          aiDecisionId: governance.decisionId,
          type: JobType.REPLY_CLASSIFICATION,
          status: JobStatus.QUEUED,
          queueName: 'replies',
          dedupeKey,
          scheduledFor: new Date(),
          maxAttempts: 3,
          payloadJson: toPrismaJson({
            replyId: reply.id,
            aiDecisionId: governance.decisionId,
          }),
        },
      });
      queuedReplyJobIds.push(created.id);
    }

    const recentWebhookReceipts = await this.prisma.webhookEventReceipt.findMany({
      where: { provider: 'resend' },
      orderBy: [{ createdAt: 'desc' }],
      take: 10,
      select: { eventId: true, eventType: true, status: true, processedAt: true },
    });

    return {
      ok: true,
      worker: 'inbox_sync',
      mode: 'webhook_canonical',
      unmatchedReplyCount: unmatchedReplies.length,
      queuedReplyClassificationCount: queuedReplyJobIds.length,
      queuedReplyJobIds,
      unmatchedReplies,
      recentWebhookReceipts,
    };
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
  }
}
