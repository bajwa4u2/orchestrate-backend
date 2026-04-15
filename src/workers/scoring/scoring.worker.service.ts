import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Job, JobType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class ScoringWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.LEAD_SCORING];

  constructor(private readonly prisma: PrismaService) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const leadId = this.readString(context.payload.leadId);
    if (!leadId) {
      throw new BadRequestException(`Job ${job.id} is missing leadId`);
    }
    return this.scoreLead(leadId);
  }

  async scoreLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { contact: true, account: true },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    let score = 40;
    if (lead.contact?.email) score += 20;
    if (lead.contact?.title) score += 10;
    if (lead.account?.companyName) score += 10;
    if (lead.account?.domain) score += 10;
    if (lead.priority && lead.priority > 70) score += 10;

    score = Math.max(1, Math.min(100, score));

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        score: new Prisma.Decimal(score),
        priority: Math.max(lead.priority ?? 50, score),
      },
    });

    return { ok: true, worker: 'scoring', leadId, score };
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
  }
}
