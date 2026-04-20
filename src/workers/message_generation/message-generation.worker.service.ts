import { BadRequestException, Injectable } from '@nestjs/common';
import { Job, JobType, Prisma } from '@prisma/client';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class MessageGenerationWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.MESSAGE_GENERATION];

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const leadId = this.readString(context.payload.leadId);
    const campaignId = this.readString(context.payload.campaignId) ?? job.campaignId;
    const clientId = this.readString(context.payload.clientId) ?? job.clientId;
    const organizationId = this.readString(context.payload.organizationId) ?? job.organizationId;

    if (!leadId || !campaignId || !clientId || !organizationId) {
      throw new BadRequestException(
        `Job ${job.id} is missing lead, campaign, client, or organization context`,
      );
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
      where: { campaignId: input.campaignId },
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

    const templateSubject = this.readString(step?.subjectTemplate);
    const templateBody = this.readString(step?.bodyTemplate);

    const writerBrief = this.buildWriterBrief({
      lead: lead as any,
      stepOrderIndex: step?.orderIndex ?? desiredStep,
      jobType: input.jobType,
      templateSubject,
      templateBody,
      note: input.note,
    });

    const aiDraft = (await this.aiService.generateOutboundDraftFromContext({
      clientId: input.clientId,
      campaignId: input.campaignId,
      leadId: input.leadId,
      stepOrderIndex: step?.orderIndex ?? desiredStep,
      jobType: input.jobType,
      note: writerBrief,
    })) as any;

    const subject =
      templateSubject ||
      this.readString(aiDraft?.draft?.subject) ||
      this.defaultSubject(lead as any);

    const body =
      this.cleanTemplateBody(templateBody) ||
      this.readString(aiDraft?.draft?.body) ||
      this.defaultBody(lead as any, input.note);

    return {
      leadId: lead.id,
      sequenceId: sequence?.id ?? null,
      sequenceStepId: step?.id ?? null,
      stepOrderIndex: step?.orderIndex ?? desiredStep,
      subject,
      body,
      metadata: {
        usedSequenceTemplate: Boolean(templateSubject || templateBody),
        usedAiDraft: Boolean(aiDraft?.draft),
        currentStep,
        desiredStep,
        aiTone: this.readString(aiDraft?.draft?.tone) ?? null,
        aiIntent: this.readString(aiDraft?.draft?.intent) ?? null,
        candidateCompany: this.readString(aiDraft?.candidate?.companyName) ?? null,
      } as Prisma.JsonObject,
    };
  }

  private buildWriterBrief(input: {
    lead: any;
    stepOrderIndex: number;
    jobType: JobType;
    templateSubject?: string;
    templateBody?: string;
    note?: string;
  }) {
    const lead = input.lead;
    const metadata = this.asObject(lead?.metadataJson);

    const contactName = this.readString(lead?.contact?.fullName);
    const firstName = contactName?.split(' ')?.[0] ?? 'there';
    const title = this.readString(lead?.contact?.title);
    const companyName = this.readString(lead?.account?.companyName);
    const companyIndustry = this.readString(lead?.account?.industry);
    const companyWebsite = this.readString(lead?.account?.websiteUrl);
    const clientName =
      this.readString(lead?.client?.displayName) ||
      this.readString(lead?.client?.legalName) ||
      'our client';
    const clientIndustry = this.readString(lead?.client?.industry);
    const campaignName = this.readString(lead?.campaign?.name);
    const offer =
      this.readString(lead?.campaign?.outboundOffer) ||
      this.readString(lead?.client?.outboundOffer);

    const recentSignal =
      this.readString(metadata.recentSignal) ||
      this.readString(metadata.signal) ||
      this.readString(metadata.observation) ||
      this.readString(metadata.reasonForFit);

    const painPoint =
      this.readString(metadata.painPoint) ||
      this.readString(metadata.problem) ||
      this.readString(metadata.qualificationNotes);

    const roleFocus = this.inferRoleFocus(title, companyIndustry);

    return [
      'Write a short cold outreach email from a real human to a specific prospect.',
      '',
      'Hard rules:',
      '- Do not use generic vendor language.',
      '- Do not say "I hope this message finds you well".',
      '- Do not say "enhance revenue operations", "scalable solutions", or similar buzzwords.',
      '- This message is sent by Orchestrate on behalf of the client, so do not pretend the sender is the client directly.',
      '- Make the representation explicit in a natural way, usually with a line like "I’m reaching out on behalf of [Client Name]."',
      '- Do not front-load with product explanation.',
      '- Do not force a meeting ask in the first email.',
      '- Keep it under 120 words.',
      '- Make it feel thoughtful, calm, and human.',
      '',
      'Structure:',
      '1. Personal or contextual opening',
      '2. One believable observation, tension, or operational friction',
      '3. One simple question that invites reply',
      '4. Simple sign-off',
      '',
      `Prospect first name: ${firstName}`,
      `Prospect full name: ${contactName ?? 'unknown'}`,
      `Prospect role: ${title ?? 'unknown'}`,
      `Prospect company: ${companyName ?? 'unknown'}`,
      `Prospect industry: ${companyIndustry ?? 'unknown'}`,
      companyWebsite ? `Prospect website: ${companyWebsite}` : null,
      `Likely role focus: ${roleFocus}`,
      `Client name: ${clientName}`,
      `Client industry: ${clientIndustry ?? 'unknown'}`,
      `Representation mode: Orchestrate reaching out on behalf of ${clientName}`,
      `Campaign name: ${campaignName ?? 'unknown'}`,
      `Offer or service context: ${offer ?? 'not provided'}`,
      `Sequence step: ${input.stepOrderIndex}`,
      `Job type: ${input.jobType}`,
      recentSignal ? `Observed signal: ${recentSignal}` : null,
      painPoint ? `Likely friction: ${painPoint}` : null,
      input.note ? `Operator note: ${input.note}` : null,
      input.templateSubject ? `Prior subject guidance: ${input.templateSubject}` : null,
      input.templateBody ? `Prior template guidance: ${this.cleanTemplateBody(input.templateBody)}` : null,
      '',
      'Write only the email subject and body in natural business English.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private inferRoleFocus(title?: string, industry?: string) {
    const normalizedTitle = (title ?? '').toLowerCase();
    const normalizedIndustry = (industry ?? '').toLowerCase();

    if (normalizedTitle.includes('revenue')) {
      return 'revenue execution, pipeline coverage, forecasting pressure';
    }
    if (normalizedTitle.includes('growth')) {
      return 'pipeline generation, campaign performance, acquisition efficiency';
    }
    if (normalizedTitle.includes('marketing')) {
      return 'campaign execution, lead quality, channel coordination';
    }
    if (normalizedTitle.includes('sales')) {
      return 'pipeline consistency, follow-up execution, meeting flow';
    }
    if (normalizedIndustry.includes('saas') || normalizedIndustry.includes('software')) {
      return 'repeatable pipeline generation and reliable outbound execution';
    }
    return 'operational consistency, follow-through, and execution quality';
  }

  private cleanTemplateBody(value?: string) {
    const body = this.readString(value);
    if (!body) {
      return undefined;
    }
    return body.replace(/\r\n/g, '\n').trim();
  }

  private defaultSubject(lead: any) {
    const company = this.readString(lead?.account?.companyName);
    const clientName =
      this.readString(lead?.client?.displayName) ||
      this.readString(lead?.client?.legalName) ||
      'Our team';

    return company ? `On behalf of ${clientName} | ${company}` : `On behalf of ${clientName}`;
  }

  private defaultBody(lead: any, note?: string) {
    const firstName = this.readString(lead?.contact?.fullName)?.split(' ')?.[0] || 'there';
    const companyName = this.readString(lead?.account?.companyName);
    const title = this.readString(lead?.contact?.title);
    const clientName =
      this.readString(lead?.client?.displayName) ||
      this.readString(lead?.client?.legalName) ||
      'Our team';

    const roleLine =
      title && companyName
        ? `${title} work at ${companyName}`
        : companyName
          ? `what your team is building at ${companyName}`
          : 'what your team is working on';

    return [
      `Hi ${firstName},`,
      '',
      `I’m reaching out from Orchestrate on behalf of ${clientName}.`,
      `Came across ${companyName ?? 'your company'} and wanted to reach out about ${roleLine}.`,
      note?.trim() || 'We often see strong teams lose momentum not on strategy, but on execution consistency.',
      '',
      'Curious how you are currently handling that on your side?',
      '',
      'Best,',
      `Orchestrate, on behalf of ${clientName}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private asObject(value: unknown): Record<string, any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    return {};
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
  }
}
