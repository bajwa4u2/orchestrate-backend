import { BadRequestException, Injectable } from '@nestjs/common';
import { Job, JobType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class InvoiceGenerationWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.INVOICE_GENERATION];

  constructor(private readonly prisma: PrismaService) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    if (!job.clientId) {
      throw new BadRequestException(`Job ${job.id} is missing clientId`);
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { clientId: job.clientId },
      select: {
        id: true,
        status: true,
        totalCents: true,
        amountPaidCents: true,
        balanceDueCents: true,
        currencyCode: true,
        issuedAt: true,
        dueAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 25,
    });

    return {
      ok: true,
      worker: 'invoice_generation',
      clientId: job.clientId,
      invoiceCount: invoices.length,
      invoices,
      metadata: context.payload,
    };
  }
}