import { Injectable } from '@nestjs/common';
import { Job, JobStatus, JobType } from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class InboxSyncWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.INBOX_SYNC];

  constructor(private readonly prisma: PrismaService) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    return this.runMailboxSync({
      organizationId: job.organizationId,
      clientId: job.clientId ?? undefined,
      campaignId: this.readString(context.payload.campaignId) ?? job.campaignId ?? undefined,
    });
  }

  async runMailboxSync(input: { clientId?: string; organizationId?: string; campaignId?: string } = {}) {
    const unmatchedReplies = await this.prisma.reply.findMany({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.campaignId ? { campaignId: input.campaignId } : {}),
        handledAt: null,
      },
      select: { id: true, messageId: true, fromEmail: true, receivedAt: true },
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

      const created = await this.prisma.job.create({
        data: {
          organizationId: input.organizationId!,
          clientId: input.clientId ?? null,
          campaignId: input.campaignId ?? null,
          type: JobType.REPLY_CLASSIFICATION,
          status: JobStatus.QUEUED,
          queueName: 'replies',
          dedupeKey,
          scheduledFor: new Date(),
          maxAttempts: 3,
          payloadJson: toPrismaJson({ replyId: reply.id }),
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
