import { BadRequestException, Injectable } from '@nestjs/common';
import { Job, JobType } from '@prisma/client';
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

    return {
      ok: true,
      worker: 'inbox_sync',
      unmatchedReplyCount: unmatchedReplies.length,
      unmatchedReplies,
    };
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
  }
}
