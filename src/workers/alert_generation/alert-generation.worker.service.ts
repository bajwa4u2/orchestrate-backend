import { Injectable } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AlertGenerationWorkerService {
  constructor(private readonly prisma: PrismaService) {}

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
