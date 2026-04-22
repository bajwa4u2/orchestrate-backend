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

    const intelligence = await this.loadIntelligenceContext({
      campaignId: input.campaignId,
      metadata,
    });

    this.assertMessageContext({
      lead,
      intelligence,
      templateSubject,
      templateBody,
    });

    const writerBrief = this.buildWriterBrief({
      lead: lead as any,
      stepOrderIndex: step?.orderIndex ?? desiredStep,
      jobType: input.jobType,
      templateSubject,
      templateBody,
      note: input.note,
      intelligence,
    });

    const aiDraft = (await this.aiService.generateOutboundDraftFromContext({
      clientId: input.clientId,
      campaignId: input.campaignId,
      leadId: input.leadId,
      stepOrderIndex: step?.orderIndex ?? desiredStep,
      jobType: input.jobType,
      note: writerBrief,
    })) as any;

    const subject = templateSubject || this.readString(aiDraft?.draft?.subject);

    const body = this.cleanTemplateBody(templateBody) || this.readString(aiDraft?.draft?.body);

    if (!subject || !body) {
      throw new BadRequestException(
        `No message draft could be generated for lead ${lead.id} with real business context`,
      );
    }

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
        opportunityProfileId: intelligence.opportunityProfileId,
        signalEventIds: intelligence.signalEventIds,
        qualificationDecisionId: intelligence.qualificationDecisionId,
        discoveredEntityId: intelligence.discoveredEntityId,
      } as Prisma.JsonObject,
    };
  }

  private async loadIntelligenceContext(input: {
    campaignId: string;
    metadata: Record<string, any>;
  }) {
    const opportunityProfileId = this.readString(input.metadata.opportunityProfileId);
    const qualificationDecisionId = this.readString(input.metadata.qualificationDecisionId);
    const discoveredEntityId = this.readString(input.metadata.discoveredEntityId);

    const opportunity = opportunityProfileId
      ? await this.prisma.opportunityProfile.findUnique({ where: { id: opportunityProfileId } })
      : await this.prisma.opportunityProfile.findFirst({
          where: { campaignId: input.campaignId },
          orderBy: { createdAt: 'desc' },
        });

    const qualification = qualificationDecisionId
      ? await this.prisma.qualificationDecision.findUnique({ where: { id: qualificationDecisionId } })
      : discoveredEntityId
        ? await this.prisma.qualificationDecision.findFirst({
            where: { campaignId: input.campaignId, discoveredEntityId },
            orderBy: { createdAt: 'desc' },
          })
        : await this.prisma.qualificationDecision.findFirst({
            where: { campaignId: input.campaignId },
            orderBy: { createdAt: 'desc' },
          });

    const signals = await this.prisma.signalEvent.findMany({
      where: {
        campaignId: input.campaignId,
        ...(opportunity?.id ? { opportunityProfileId: opportunity.id } : {}),
      },
      orderBy: [{ confidenceScore: 'desc' }, { createdAt: 'desc' }],
      take: 3,
    });

    const discoveredEntity = discoveredEntityId
      ? await this.prisma.discoveredEntity.findUnique({ where: { id: discoveredEntityId } })
      : qualification?.discoveredEntityId
        ? await this.prisma.discoveredEntity.findUnique({ where: { id: qualification.discoveredEntityId } })
        : null;

    const qualificationReasonJson = this.asObject(qualification?.reasonJson);

    return {
      opportunityProfileId: opportunity?.id ?? null,
      opportunityType: this.readString(opportunity?.opportunityType),
      targetDescription: this.readString(opportunity?.targetDescription),
      serviceContext: this.readString(opportunity?.serviceContext),
      offerContext: this.readString(opportunity?.offerContext),
      strategyJson: this.asObject(opportunity?.strategyJson),
      qualificationDecisionId: qualification?.id ?? null,
      qualificationDecision: this.readString(qualification?.decision),
      qualificationScore: qualification?.finalScore != null ? Number(qualification.finalScore) : null,
      qualificationReasoning: this.buildQualificationReasoning(qualificationReasonJson),
      discoveredEntityId: discoveredEntity?.id ?? null,
      discoveredEntityEvidence: this.asObject(discoveredEntity?.sourceEvidenceJson),
      signalEventIds: signals.map((item) => item.id),
      signals: signals.map((item) => ({
        type: item.signalType,
        sourceType: item.signalSourceType,
        headline: this.readString(item.headlineOrLabel),
        geography: this.readString(item.geography),
        confidenceScore: item.confidenceScore,
        recencyScore: item.recencyScore,
        payload: this.asObject(item.payloadJson),
        normalized: this.asObject(item.normalizedJson),
      })),
    };
  }

  private assertMessageContext(input: {
    lead: any;
    intelligence: any;
    templateSubject?: string;
    templateBody?: string;
  }) {
    const hasOpportunity = Boolean(
      input.intelligence.opportunityProfileId &&
        (input.intelligence.targetDescription ||
          input.intelligence.offerContext ||
          input.intelligence.serviceContext ||
          input.intelligence.opportunityType),
    );
    const hasSignal = Array.isArray(input.intelligence.signals) && input.intelligence.signals.length > 0;
    const hasQualification = Boolean(
      input.intelligence.qualificationDecisionId &&
        (input.intelligence.qualificationReasoning ||
          input.intelligence.qualificationDecision ||
          input.intelligence.qualificationScore != null),
    );
    const hasTemplate = Boolean(input.templateSubject || input.templateBody);

    if (!hasOpportunity && !hasSignal && !hasQualification && !hasTemplate) {
      throw new BadRequestException(
        `Lead ${input.lead.id} is missing opportunity, signal, and qualification context for first outreach`,
      );
    }
  }

  private buildWriterBrief(input: {
    lead: any;
    stepOrderIndex: number;
    jobType: JobType;
    templateSubject?: string;
    templateBody?: string;
    note?: string;
    intelligence: any;
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
      this.readString(lead?.campaign?.offerSummary) ||
      this.readString(lead?.campaign?.outboundOffer) ||
      this.readString(lead?.client?.outboundOffer) ||
      this.readString(input.intelligence.offerContext);
    const serviceContext =
      this.readString(input.intelligence.serviceContext) ||
      this.readString(input.intelligence.targetDescription) ||
      this.readString(lead?.campaign?.objective);

    const roleFocus = this.inferRoleFocus(title, companyIndustry);
    const strongestSignal = Array.isArray(input.intelligence.signals)
      ? input.intelligence.signals[0]
      : null;
    const signalLine = strongestSignal
      ? [
          this.readString(strongestSignal.headline),
          this.readString(strongestSignal.geography),
          this.readString(strongestSignal.type),
        ]
          .filter(Boolean)
          .join(' | ')
      : this.readString(metadata.recentSignal) ||
        this.readString(metadata.signal) ||
        this.readString(metadata.observation) ||
        this.readString(metadata.reasonForFit);
    const qualificationReason =
      this.readString(input.intelligence.qualificationReasoning) ||
      this.readString(metadata.painPoint) ||
      this.readString(metadata.problem) ||
      this.readString(metadata.qualificationNotes);

    return [
      'Write a short, specific B2B cold outreach email from a real human to a real prospect.',
      '',
      'Hard rules:',
      '- Do not use generic vendor language or broad claims.',
      '- Do not say "I hope this message finds you well".',
      '- Do not say "enhance revenue operations", "scalable solutions", or similar buzzwords.',
      '- Do not say "on behalf of" in the body unless there is no better natural phrasing.',
      '- The recipient should feel the client business context, not the platform brand.',
      '- Do not invent pain points. Use only the context provided below.',
      '- If the signal is weak, stay restrained and observational.',
      '- Keep it under 120 words.',
      '- End with one simple reply-opening question.',
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
      `Campaign name: ${campaignName ?? 'unknown'}`,
      offer ? `Client offer context: ${offer}` : null,
      serviceContext ? `Service / objective context: ${serviceContext}` : null,
      input.intelligence.opportunityType
        ? `Opportunity type: ${input.intelligence.opportunityType}`
        : null,
      signalLine ? `Observed signal: ${signalLine}` : null,
      qualificationReason ? `Qualification reasoning: ${qualificationReason}` : null,
      input.intelligence.qualificationScore != null
        ? `Qualification score: ${input.intelligence.qualificationScore}`
        : null,
      input.note ? `Operator note: ${input.note}` : null,
      input.templateSubject ? `Prior subject guidance: ${input.templateSubject}` : null,
      input.templateBody
        ? `Prior template guidance: ${this.cleanTemplateBody(input.templateBody)}`
        : null,
      '',
      'Write only the email subject and body in natural business English.',
      'Make the opening depend on the observed signal or qualification reasoning, not generic outreach language.',
      'Let the client business context stay central throughout the email.',
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

  private buildQualificationReasoning(reasonJson: Record<string, any>) {
    return [
      reasonJson.hasDirectPerson === true ? 'direct person identified' : null,
      reasonJson.hasEmailCandidate === true ? 'email candidate available' : null,
      this.readString(reasonJson.inferredRole) ? `role: ${this.readString(reasonJson.inferredRole)}` : null,
      this.readString(reasonJson.sourcePolicyStatus)
        ? `source policy: ${this.readString(reasonJson.sourcePolicyStatus)}`
        : null,
      this.readString(reasonJson.contactPolicyStatus)
        ? `contact policy: ${this.readString(reasonJson.contactPolicyStatus)}`
        : null,
      reasonJson.policyPenalty != null ? `policy penalty: ${String(reasonJson.policyPenalty)}` : null,
    ]
      .filter(Boolean)
      .join(', ');
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
