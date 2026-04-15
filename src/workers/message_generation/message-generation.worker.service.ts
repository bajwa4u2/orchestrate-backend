import { BadRequestException, Injectable } from '@nestjs/common';
import { Job, JobType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class MessageGenerationWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.MESSAGE_GENERATION];

  constructor(private readonly prisma: PrismaService) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const leadId = this.readString(context.payload.leadId);
    const campaignId = this.readString(context.payload.campaignId) ?? job.campaignId;
    const clientId = this.readString(context.payload.clientId) ?? job.clientId;
    const organizationId = this.readString(context.payload.organizationId) ?? job.organizationId;

    if (!leadId || !campaignId || !clientId || !organizationId) {
      throw new BadRequestException(`Job ${job.id} is missing lead, campaign, client, or organization context`);
    }

    const prepared = await this.prepareLeadMessage({
      leadId,
      campaignId,
      clientId,
      organizationId,
      jobType: job.type,
      note: this.readString(context.payload.note) ?? undefined,
    });

    return { ok: true, worker: 'message_generation', ...prepared };
  }

  async prepareLeadMessage(input: {
    leadId: string;
    campaignId: string;
    clientId: string;
    organizationId: string;
    jobType: JobType;
    note?: string;
  }) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: input.leadId },
      include: {
        campaign: true,
        client: true,
        contact: true,
        account: true,
      },
    });

    if (!lead) {
      throw new Error(`Lead ${input.leadId} not found`);
    }

    const sequence = await this.prisma.sequence.findFirst({
      where: {
        campaignId: input.campaignId,
      },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    });

    const metadata = this.asObject(lead.metadataJson);
    const sequenceState = this.asObject(metadata.sequenceState);
    const currentStep = Math.max(1, Number(sequenceState.currentStep ?? 1));
    const desiredStep = input.jobType === JobType.FOLLOWUP_SEND ? currentStep + 1 : currentStep;

    const step = sequence
      ? await this.prisma.sequenceStep.findFirst({
          where: {
            sequenceId: sequence.id,
            orderIndex: desiredStep,
          },
          orderBy: [{ orderIndex: 'asc' }],
        })
      : null;

    const subject = this.readString(step?.subjectTemplate) || this.defaultSubject(lead);
    const body = this.readString(step?.bodyTemplate) || this.defaultBody(lead, input.note);

    return {
      leadId: lead.id,
      sequenceId: sequence?.id ?? null,
      sequenceStepId: step?.id ?? null,
      stepOrderIndex: step?.orderIndex ?? desiredStep,
      subject,
      body,
      metadata: {
        usedSequenceTemplate: Boolean(step),
        currentStep,
        desiredStep,
      } satisfies Prisma.JsonObject,
    };
  }

  private defaultSubject(lead: { account?: { companyName?: string | null } | null; client: { displayName: string } }) {
    const company = lead.account?.companyName?.trim();
    return company ? `${lead.client.displayName} x ${company}` : `${lead.client.displayName}`;
  }

  private defaultBody(
    lead: { contact?: { fullName?: string | null } | null; client: { displayName: string } },
    note?: string,
  ) {
    const firstName = lead.contact?.fullName?.trim()?.split(' ')?.[0] || 'there';
    return [
      `Hi ${firstName},`,
      '',
      `I’m reaching out from ${lead.client.displayName}.`,
      note?.trim() || 'I thought this might be relevant to what your team is working on.',
      '',
      'Best,',
      lead.client.displayName,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
  }
}
