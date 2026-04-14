import { Injectable } from '@nestjs/common';
import { JobType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class MessageGenerationWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<WorkerRunResult> {
    return { ok: true, worker: 'message_generation', mode: 'direct_only' };
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

    const fallbackSubject = this.buildFallbackSubject(lead, input.jobType);
    const fallbackBody = this.buildFallbackBody(lead, input.jobType, input.note);

    const subject = this.renderTemplate(step?.subjectTemplate ?? fallbackSubject, {
      first_name: lead.contact?.firstName,
      full_name: lead.contact?.fullName,
      company_name: lead.account?.companyName,
      client_name: lead.client?.displayName,
      offer: lead.campaign?.offerSummary ?? lead.client?.outboundOffer,
      note: input.note,
    });

    const bodyText = this.renderTemplate(step?.bodyTemplate ?? fallbackBody, {
      first_name: lead.contact?.firstName,
      full_name: lead.contact?.fullName,
      company_name: lead.account?.companyName,
      client_name: lead.client?.displayName,
      offer: lead.campaign?.offerSummary ?? lead.client?.outboundOffer,
      note: input.note,
    });

    const draft = await this.prisma.outreachMessage.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        leadId: input.leadId,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        status: 'QUEUED',
        source: 'SYSTEM_GENERATED',
        lifecycle: 'DRAFT',
        subjectLine: subject,
        bodyText,
        metadataJson: {
          type: 'generated_sequence_message',
          jobType: input.jobType,
          sequenceId: sequence?.id ?? null,
          sequenceStepId: step?.id ?? null,
          sequenceStepOrder: step?.orderIndex ?? desiredStep,
          waitDays: step?.waitDays ?? (input.jobType === JobType.FOLLOWUP_SEND ? 3 : 0),
          generatedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        subjectLine: true,
        bodyText: true,
      },
    });

    return {
      draftMessageId: draft.id,
      subject: draft.subjectLine ?? subject,
      bodyText: draft.bodyText ?? bodyText,
      sequenceId: sequence?.id ?? null,
      sequenceStepId: step?.id ?? null,
      sequenceStepOrder: step?.orderIndex ?? desiredStep,
      waitDays: step?.waitDays ?? (input.jobType === JobType.FOLLOWUP_SEND ? 3 : 0),
    };
  }

  private buildFallbackSubject(lead: any, jobType: JobType) {
    const company = lead.account?.companyName || lead.client?.displayName || 'your team';
    return jobType === JobType.FOLLOWUP_SEND ? `Following up about ${company}` : `Quick intro for ${company}`;
  }

  private buildFallbackBody(lead: any, jobType: JobType, note?: string) {
    const firstName = lead.contact?.firstName || lead.contact?.fullName || 'there';
    const offer = lead.campaign?.offerSummary || lead.client?.outboundOffer || 'a relevant business offer';
    const intro =
      jobType === JobType.FOLLOWUP_SEND
        ? `Hi ${firstName},\n\nFollowing up on my earlier note.`
        : `Hi ${firstName},\n\nReaching out with a quick intro.`;

    return [
      intro,
      `\n\nWe are helping teams around: ${offer}.`,
      note ? `\n\nNote: ${note}` : '',
      `\n\nBest,\nOrchestrate`,
    ].join('');
  }

  private renderTemplate(template: string, variables: Record<string, unknown>) {
    return Object.entries(variables).reduce((acc, [key, value]) => {
      const safe = typeof value === 'string' && value.trim().length ? value.trim() : '';
      return acc.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'gi'), safe);
    }, template);
  }

  private asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {};
  }
}
