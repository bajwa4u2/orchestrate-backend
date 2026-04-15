import { Injectable } from '@nestjs/common';
import { Job, JobStatus, JobType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class AlertGenerationWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.ALERT_EVALUATION];

  constructor(private readonly prisma: PrismaService) {}

  async run(job: Job): Promise<WorkerRunResult> {
    return this.generateAlerts({ organizationId: job.organizationId, clientId: job.clientId ?? undefined });
  }

  async generateAlerts(input: { organizationId?: string; clientId?: string } = {}) {
    const failedJobs = await this.prisma.job.findMany({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        status: JobStatus.FAILED,
      },
      select: { id: true, type: true, lastError: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }],
      take: 25,
    });

    const pausedMailboxes = await this.prisma.mailbox.count({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        status: { in: ['PAUSED', 'ERROR'] as any },
      },
    });

    return {
      ok: true,
      worker: 'alert_generation',
      failedJobCount: failedJobs.length,
      pausedMailboxCount: pausedMailboxes,
      failedJobs,
    };
  }
}
