import { Injectable } from '@nestjs/common';
import {
  ActivityKind,
  ActivityVisibility,
  CampaignStatus,
  ContactEmailStatus,
  LeadQualificationState,
  LeadStatus,
  JobType,
  MessageChannel,
  MessageDirection,
  MessageLifecycle,
  MessageStatus,
  Prisma,
  QualificationStatus,
  RecordSource,
  SequenceStatus,
  SequenceStepStatus,
  SequenceStepType,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import {
  ActivateGrowthWorkspaceDto,
  GenerateAgreementDraftDto,
  GenerateGrowthMessagesDto,
  GenerateGrowthSequenceDto,
  GenerateReminderDto,
  GenerateStatementSummaryDto,
} from './contracts/ai.controller.contract';
import { LeadCandidate } from './contracts/lead.contract';
import { ServiceProfileInput } from './contracts/service-profile.contract';
import { StrategyBrief } from './contracts/strategy.contract';
import { LeadAgent } from './agents/lead.agent';
import { SequenceAgent } from './agents/sequence.agent';
import { StrategyAgent } from './agents/strategy.agent';
import { WriterAgent } from './agents/writer.agent';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly strategyAgent: StrategyAgent,
    private readonly leadAgent: LeadAgent,
    private readonly writerAgent: WriterAgent,
    private readonly sequenceAgent: SequenceAgent,
  ) {}

  async activateGrowthWorkspace(input: ActivateGrowthWorkspaceDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: {
        id: true,
        organizationId: true,
        legalName: true,
        displayName: true,
        industry: true,
        websiteUrl: true,
        bookingUrl: true,
        outboundOffer: true,
      },
    });

    const businessName = client.displayName || client.legalName;

    const workflow = await this.workflows.createWorkflowRun({
      clientId: client.id,
      lane: WorkflowLane.GROWTH,
      type: WorkflowType.CAMPAIGN_GENERATION,
      status: WorkflowStatus.RUNNING,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.AI_GENERATED,
      title: input.workflowTitle ?? `Growth activation for ${businessName}`,
      inputJson: {
        clientId: input.clientId,
        setup: input.setup,
      },
      contextJson: {
        initiatedBy: 'ai.controller',
        endpoint: 'POST /v1/ai/growth/activate',
      },
    });

    const serviceProfile: ServiceProfileInput = {
      organizationId: client.organizationId,
      clientId: client.id,
      businessName,
      websiteUrl: client.websiteUrl ?? undefined,
      industry: input.setup.industry,
      offerName: input.setup.offer ?? client.outboundOffer ?? 'Outbound growth service',
      offerSummary:
        input.setup.offer ??
        client.outboundOffer ??
        'Structured outbound outreach and follow-up automation',
      desiredOutcome: input.setup.goal,
      countries: input.setup.country,
      regions: input.setup.regions ?? [],
      buyerRoles: input.setup.roles,
      tone: input.setup.tone ?? 'professional-direct',
      callToAction: 'Book a meeting',
      bookingUrl: client.bookingUrl ?? undefined,
      complianceNotes: input.setup.constraints ?? [],
      maxLeads: 24,
      dailySendCap: 25,
      sequenceStepCount: 3,
    };

    const strategy = await this.strategyAgent.generate(serviceProfile);

    const campaignMetadata = {
      strategy: strategy as unknown as Prisma.InputJsonValue,
      serviceProfile: serviceProfile as unknown as Prisma.InputJsonValue,
    } as unknown as Prisma.InputJsonValue;

    const campaign = await this.prisma.campaign.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        workflowRunId: workflow.id,
        name: strategy.campaignName,
        status: CampaignStatus.DRAFT,
        source: RecordSource.AI_GENERATED,
        generationState: 'TARGETING_READY',
        channel: MessageChannel.EMAIL,
        objective: strategy.objective,
        offerSummary: strategy.offerSummary,
        bookingUrlOverride: strategy.bookingUrlOverride ?? client.bookingUrl ?? undefined,
        metadataJson: campaignMetadata,
      },
      select: { id: true, name: true },
    });

    await this.workflows.attachWorkflowSubjects(workflow.id, {
      campaignId: campaign.id,
      title: `Campaign generation for ${campaign.name}`,
      contextJson: {
        endpoint: 'POST /v1/ai/growth/activate',
        campaignId: campaign.id,
      },
    });

    const leadCandidates = await this.leadAgent.generate(
      strategy,
      serviceProfile.maxLeads ?? 12,
    );

    const createdLeads: Array<{
      id: string;
      label: string;
      candidate: LeadCandidate;
    }> = [];

    for (const lead of leadCandidates) {
      const account = await this.prisma.account.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          domain: lead.domain ?? null,
          companyName: lead.companyName,
          industry: lead.industry ?? input.setup.industry,
          employeeCount: lead.employeeCount ?? null,
          city: lead.city ?? null,
          region: lead.region ?? null,
          countryCode: lead.countryCode ?? null,
          websiteUrl: lead.domain ? `https://${lead.domain}` : null,
          qualificationStatus: QualificationStatus.UNREVIEWED,
          enrichmentJson: {
            reasonForFit: lead.reasonForFit,
            qualificationNotes: lead.qualificationNotes ?? null,
          },
        },
        select: { id: true },
      });

      const contact = await this.prisma.contact.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          accountId: account.id,
          firstName: lead.firstName ?? null,
          lastName: lead.lastName ?? null,
          fullName: lead.contactFullName,
          title: lead.title,
          email: lead.email ?? null,
          emailStatus: lead.email
            ? ContactEmailStatus.UNVERIFIED
            : ContactEmailStatus.UNVERIFIED,
          linkedinUrl: lead.linkedinUrl ?? null,
          timezone: lead.timezone ?? null,
          city: lead.city ?? null,
          region: lead.region ?? null,
          countryCode: lead.countryCode ?? null,
          qualificationStatus: QualificationStatus.UNREVIEWED,
          enrichmentJson: {
            reasonForFit: lead.reasonForFit,
            qualificationNotes: lead.qualificationNotes ?? null,
          },
        },
        select: { id: true, fullName: true },
      });

      const createdLead = await this.prisma.lead.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          accountId: account.id,
          contactId: contact.id,
          workflowRunId: workflow.id,
          status: LeadStatus.NEW,
          source: RecordSource.AI_GENERATED,
          qualificationState: LeadQualificationState.DISCOVERED,
          priority: lead.priority ?? 0,
          metadataJson: {
            reasonForFit: lead.reasonForFit,
            qualificationNotes: lead.qualificationNotes ?? null,
          },
        },
        select: { id: true },
      });

      createdLeads.push({
        id: createdLead.id,
        label: contact.fullName,
        candidate: lead,
      });
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { generationState: 'LEADS_READY' },
    });

    let messageCount = 0;

    for (const lead of createdLeads) {
      const message = await this.writerAgent.generate(strategy, lead.candidate);

      await this.prisma.outreachMessage.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          leadId: lead.id,
          workflowRunId: workflow.id,
          direction: MessageDirection.OUTBOUND,
          channel: MessageChannel.EMAIL,
          status: MessageStatus.QUEUED,
          source: RecordSource.AI_GENERATED,
          lifecycle: MessageLifecycle.DRAFT,
          subjectLine: message.subject,
          bodyText: message.body,
          metadataJson: {
            tone: message.tone,
            intent: message.intent,
          },
        },
      });

      messageCount += 1;
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { generationState: 'MESSAGES_READY' },
    });

    const sequenceSteps = await this.sequenceAgent.generate(
      strategy,
      serviceProfile.sequenceStepCount ?? 3,
    );

    const sequence = await this.prisma.sequence.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        campaignId: campaign.id,
        workflowRunId: workflow.id,
        name: `${campaign.name} sequence`,
        status: SequenceStatus.DRAFT,
        source: RecordSource.AI_GENERATED,
        description: strategy.segmentNotes ?? null,
      },
      select: { id: true },
    });

    for (const step of sequenceSteps) {
      await this.prisma.sequenceStep.create({
        data: {
          sequenceId: sequence.id,
          orderIndex: step.orderIndex,
          type: SequenceStepType.EMAIL,
          status: SequenceStepStatus.ACTIVE,
          waitDays: step.waitDays,
          subjectTemplate: step.subjectTemplate ?? null,
          bodyTemplate: step.bodyTemplate ?? null,
          instructionText: step.instructionText ?? null,
        },
      });
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { generationState: 'SEQUENCE_READY' },
    });

    await this.prisma.activityEvent.createMany({
      data: [
        {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          workflowRunId: workflow.id,
          kind: ActivityKind.CAMPAIGN_CREATED,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'campaign',
          subjectId: campaign.id,
          summary: 'Targeting configured',
          metadataJson: { campaignId: campaign.id },
        },
        {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          workflowRunId: workflow.id,
          kind: ActivityKind.LEAD_IMPORTED,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'campaign',
          subjectId: campaign.id,
          summary: `${createdLeads.length} leads prepared`,
          metadataJson: { campaignId: campaign.id, count: createdLeads.length },
        },
        {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          workflowRunId: workflow.id,
          kind: ActivityKind.NOTE_ADDED,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'campaign',
          subjectId: campaign.id,
          summary: `${messageCount} messages drafted`,
          metadataJson: { campaignId: campaign.id, count: messageCount },
        },
      ],
    });

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { generationState: 'READY_TO_LAUNCH' },
    });

    await this.workflows.completeWorkflowRun(workflow.id, {
      campaignId: campaign.id,
      sequenceId: sequence.id,
      leadCount: createdLeads.length,
      messageCount,
    });

    return {
      workflowRunId: workflow.id,
      campaignId: campaign.id,
      sequenceId: sequence.id,
      leadCount: createdLeads.length,
      messageCount,
      status: 'READY_TO_LAUNCH',
    };
  }

  async bootstrapCampaignActivation(input: {
    clientId: string;
    campaignId: string;
    workflowRunId?: string;
    workflowTitle?: string;
  }) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: {
        id: true,
        organizationId: true,
        legalName: true,
        displayName: true,
        industry: true,
        websiteUrl: true,
        bookingUrl: true,
        outboundOffer: true,
        scopeJson: true,
      },
    });

    const campaign = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
      select: {
        id: true,
        name: true,
        workflowRunId: true,
        objective: true,
        offerSummary: true,
        bookingUrlOverride: true,
        metadataJson: true,
      },
    });

    const workflowRunId = input.workflowRunId ?? campaign.workflowRunId ?? undefined;
    const businessName = client.displayName || client.legalName;
    const scope = client.scopeJson && typeof client.scopeJson === 'object' && !Array.isArray(client.scopeJson)
      ? (client.scopeJson as Record<string, unknown>)
      : {};

    const countries = Array.isArray(scope.countries)
      ? (scope.countries as Array<Record<string, unknown>>).map((item) => String(item.label ?? item.code ?? '')).filter(Boolean)
      : [];
    const regions = Array.isArray(scope.regions)
      ? (scope.regions as Array<Record<string, unknown>>).map((item) => String(item.regionLabel ?? item.regionCode ?? '')).filter(Boolean)
      : [];
    const industries = Array.isArray(scope.industries)
      ? (scope.industries as Array<Record<string, unknown>>).map((item) => String(item.label ?? item.code ?? '')).filter(Boolean)
      : [];

    const serviceProfile: ServiceProfileInput = {
      organizationId: client.organizationId,
      clientId: client.id,
      businessName,
      websiteUrl: client.websiteUrl ?? undefined,
      industry: industries[0] ?? client.industry ?? 'General business services',
      offerName: campaign.offerSummary ?? client.outboundOffer ?? 'Outbound growth service',
      offerSummary: campaign.offerSummary ?? client.outboundOffer ?? 'Structured outbound outreach and follow-up automation',
      desiredOutcome: campaign.objective ?? 'Book qualified meetings with decision makers',
      countries,
      regions,
      buyerRoles: ['Founder', 'Owner', 'Director', 'Head of Operations'],
      tone: 'professional-direct',
      callToAction: 'Book a meeting',
      bookingUrl: campaign.bookingUrlOverride ?? client.bookingUrl ?? undefined,
      complianceNotes: [],
      maxLeads: 24,
      dailySendCap: 25,
      sequenceStepCount: 3,
    };

    const rawStrategy = await this.strategyAgent.generate(serviceProfile);
    const strategy = this.normalizeStrategyBrief(rawStrategy, {
      icpName: businessName,
      campaignName: campaign.name,
      objective: campaign.objective ?? 'Book qualified meetings with decision makers',
      offerSummary: campaign.offerSummary ?? client.outboundOffer ?? 'Structured outbound outreach and follow-up automation',
      industryTags: industries,
      geoTargets: [...countries, ...regions],
      titleKeywords: serviceProfile.buyerRoles,
      exclusionKeywords: [],
      painPoints: this.derivePainPoints(client.outboundOffer, client.industry),
      valueAngles: this.deriveValueAngles(client.outboundOffer),
      tone: serviceProfile.tone,
      callToAction: serviceProfile.callToAction,
      bookingUrlOverride: serviceProfile.bookingUrl,
      segmentNotes: undefined,
    });

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: CampaignStatus.DRAFT,
        source: RecordSource.AI_GENERATED,
        generationState: 'TARGETING_READY',
        objective: strategy.objective,
        offerSummary: strategy.offerSummary,
        bookingUrlOverride: strategy.bookingUrlOverride ?? campaign.bookingUrlOverride ?? client.bookingUrl ?? undefined,
        metadataJson: {
          strategy: strategy as unknown as Prisma.InputJsonValue,
          serviceProfile: serviceProfile as unknown as Prisma.InputJsonValue,
          priorMetadata: campaign.metadataJson ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const existingLeadIds = await this.prisma.lead.findMany({
      where: { campaignId: campaign.id },
      include: { contact: true, account: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 50,
    });

    const createdLeads: Array<{
      id: string;
      label: string;
      candidate: LeadCandidate;
      sendable: boolean;
    }> = [];

    if (!existingLeadIds.length) {
      const leadCandidates = await this.leadAgent.generate(strategy, serviceProfile.maxLeads ?? 12);

      for (const lead of leadCandidates) {
        const existingContact = lead.email
          ? await this.prisma.contact.findFirst({
              where: {
                clientId: client.id,
                email: lead.email,
              },
              select: { id: true, accountId: true, fullName: true },
            })
          : null;

        let accountId = existingContact?.accountId ?? null;
        let contactId = existingContact?.id ?? null;

        if (!accountId && lead.companyName) {
          const existingAccount = await this.prisma.account.findFirst({
            where: {
              clientId: client.id,
              OR: [
                ...(lead.domain ? [{ domain: lead.domain }] : []),
                { companyName: lead.companyName },
              ],
            },
            select: { id: true },
          });
          if (existingAccount) {
            accountId = existingAccount.id;
          }
        }

        if (!accountId) {
          const account = await this.prisma.account.create({
            data: {
              organizationId: client.organizationId,
              clientId: client.id,
              domain: lead.domain ?? null,
              companyName: lead.companyName,
              industry: lead.industry ?? serviceProfile.industry,
              employeeCount: lead.employeeCount ?? null,
              city: lead.city ?? null,
              region: lead.region ?? null,
              countryCode: lead.countryCode ?? null,
              websiteUrl: lead.domain ? `https://${lead.domain}` : null,
              qualificationStatus: QualificationStatus.UNREVIEWED,
              enrichmentJson: {
                reasonForFit: lead.reasonForFit,
                qualificationNotes: lead.qualificationNotes ?? null,
              },
            },
            select: { id: true },
          });
          accountId = account.id;
        }

        if (!contactId) {
          const contact = await this.prisma.contact.create({
            data: {
              organizationId: client.organizationId,
              clientId: client.id,
              accountId,
              firstName: lead.firstName ?? null,
              lastName: lead.lastName ?? null,
              fullName: lead.contactFullName,
              title: lead.title,
              email: lead.email ?? null,
              emailStatus: ContactEmailStatus.UNVERIFIED,
              linkedinUrl: lead.linkedinUrl ?? null,
              timezone: lead.timezone ?? null,
              city: lead.city ?? null,
              region: lead.region ?? null,
              countryCode: lead.countryCode ?? null,
              qualificationStatus: QualificationStatus.UNREVIEWED,
              enrichmentJson: {
                reasonForFit: lead.reasonForFit,
                qualificationNotes: lead.qualificationNotes ?? null,
              },
            },
            select: { id: true, fullName: true },
          });
          contactId = contact.id;
        }

        const createdLead = await this.prisma.lead.create({
          data: {
            organizationId: client.organizationId,
            clientId: client.id,
            campaignId: campaign.id,
            accountId,
            contactId,
            workflowRunId,
            status: LeadStatus.NEW,
            source: RecordSource.AI_GENERATED,
            qualificationState: LeadQualificationState.DISCOVERED,
            priority: lead.priority ?? 0,
            metadataJson: {
              reasonForFit: lead.reasonForFit,
              qualificationNotes: lead.qualificationNotes ?? null,
            },
          },
          select: { id: true },
        });

        createdLeads.push({
          id: createdLead.id,
          label: lead.contactFullName,
          candidate: lead,
          sendable: Boolean(lead.email),
        });
      }
    }

    const leadRows = createdLeads.length
      ? createdLeads
      : existingLeadIds.map((lead) => ({
          id: lead.id,
          label: lead.contact?.fullName ?? lead.account?.companyName ?? lead.id,
          candidate: {
            companyName: lead.account?.companyName ?? businessName,
            contactFullName: lead.contact?.fullName ?? 'Decision maker',
            title: lead.contact?.title ?? 'Decision maker',
            reasonForFit: 'Matched to campaign scope',
            email: lead.contact?.email ?? undefined,
          } as LeadCandidate,
          sendable: Boolean(lead.contact?.email),
        }));

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { generationState: 'LEADS_READY' },
    });

    let messageCount = 0;

    for (const lead of leadRows) {
      const existingMessage = await this.prisma.outreachMessage.findFirst({
        where: {
          campaignId: campaign.id,
          leadId: lead.id,
          lifecycle: MessageLifecycle.DRAFT,
        },
        select: { id: true },
      });

      if (existingMessage) {
        messageCount += 1;
        continue;
      }

      const message = await this.writerAgent.generate(strategy, lead.candidate);
      await this.prisma.outreachMessage.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          leadId: lead.id,
          workflowRunId,
          direction: MessageDirection.OUTBOUND,
          channel: MessageChannel.EMAIL,
          status: MessageStatus.QUEUED,
          source: RecordSource.AI_GENERATED,
          lifecycle: MessageLifecycle.DRAFT,
          subjectLine: message.subject,
          bodyText: message.body,
          metadataJson: {
            tone: message.tone,
            intent: message.intent,
          },
        },
      });
      messageCount += 1;
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { generationState: 'MESSAGES_READY' },
    });

    let sequenceId: string | null = null;
    const existingSequence = await this.prisma.sequence.findFirst({
      where: { campaignId: campaign.id },
      select: { id: true },
    });

    if (existingSequence) {
      sequenceId = existingSequence.id;
    } else {
      const sequenceSteps = await this.sequenceAgent.generate(strategy, serviceProfile.sequenceStepCount ?? 3);
      const sequence = await this.prisma.sequence.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          workflowRunId,
          name: `${campaign.name} sequence`,
          status: SequenceStatus.DRAFT,
          source: RecordSource.AI_GENERATED,
          description: strategy.segmentNotes ?? null,
        },
        select: { id: true },
      });
      sequenceId = sequence.id;

      for (const step of sequenceSteps) {
        await this.prisma.sequenceStep.create({
          data: {
            sequenceId: sequence.id,
            orderIndex: step.orderIndex,
            type: SequenceStepType.EMAIL,
            status: SequenceStepStatus.ACTIVE,
            waitDays: step.waitDays,
            subjectTemplate: step.subjectTemplate ?? null,
            bodyTemplate: step.bodyTemplate ?? null,
            instructionText: step.instructionText ?? null,
          },
        });
      }
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { generationState: 'READY_TO_LAUNCH' },
    });

    if (workflowRunId) {
      await this.prisma.activityEvent.createMany({
        data: [
          {
            organizationId: client.organizationId,
            clientId: client.id,
            campaignId: campaign.id,
            workflowRunId,
            kind: ActivityKind.CAMPAIGN_CREATED,
            visibility: ActivityVisibility.CLIENT_VISIBLE,
            subjectType: 'campaign',
            subjectId: campaign.id,
            summary: 'Automatic launch prepared targeting',
            metadataJson: { campaignId: campaign.id },
          },
          {
            organizationId: client.organizationId,
            clientId: client.id,
            campaignId: campaign.id,
            workflowRunId,
            kind: ActivityKind.LEAD_IMPORTED,
            visibility: ActivityVisibility.CLIENT_VISIBLE,
            subjectType: 'campaign',
            subjectId: campaign.id,
            summary: `${leadRows.length} leads prepared`,
            metadataJson: { campaignId: campaign.id, count: leadRows.length },
          },
          {
            organizationId: client.organizationId,
            clientId: client.id,
            campaignId: campaign.id,
            workflowRunId,
            kind: ActivityKind.NOTE_ADDED,
            visibility: ActivityVisibility.CLIENT_VISIBLE,
            subjectType: 'campaign',
            subjectId: campaign.id,
            summary: `${messageCount} messages drafted`,
            metadataJson: { campaignId: campaign.id, count: messageCount },
          },
        ],
      });
    }

    return {
      workflowRunId,
      campaignId: campaign.id,
      sequenceId,
      leadIds: leadRows.map((item) => item.id),
      leadCount: leadRows.length,
      sendableLeadIds: leadRows.filter((item) => item.sendable).map((item) => item.id),
      sendableLeadCount: leadRows.filter((item) => item.sendable).length,
      messageCount,
      status: 'READY_TO_LAUNCH',
    };
  }


  async generateOutboundDraftFromContext(input: {
    clientId: string;
    campaignId: string;
    leadId: string;
    stepOrderIndex: number;
    jobType: JobType;
    note?: string;
  }) {
    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: input.leadId },
      include: {
        client: true,
        campaign: true,
        contact: true,
        account: true,
      },
    });

    const campaignMetadata = lead.campaign?.metadataJson && typeof lead.campaign.metadataJson === 'object' && !Array.isArray(lead.campaign.metadataJson)
      ? (lead.campaign.metadataJson as Record<string, unknown>)
      : {};
    const strategySource = campaignMetadata.strategy && typeof campaignMetadata.strategy === 'object' && !Array.isArray(campaignMetadata.strategy)
      ? (campaignMetadata.strategy as Record<string, unknown>)
      : {};
    const serviceProfile = campaignMetadata.serviceProfile && typeof campaignMetadata.serviceProfile === 'object' && !Array.isArray(campaignMetadata.serviceProfile)
      ? (campaignMetadata.serviceProfile as Record<string, unknown>)
      : {};
    const scope = lead.client?.scopeJson && typeof lead.client.scopeJson === 'object' && !Array.isArray(lead.client.scopeJson)
      ? (lead.client.scopeJson as Record<string, unknown>)
      : {};

    const geoTargets = [
      ...this.readStringArray(strategySource.geoTargets),
      ...this.readStringArray(serviceProfile.countries),
      ...this.readStringArray(serviceProfile.regions),
    ];
    const industryTags = [
      ...this.readStringArray(strategySource.industryTags),
      ...this.readStringArray(scope.industries).map((item) => item),
      lead.account?.industry ?? undefined,
      lead.client?.industry ?? undefined,
    ].filter(Boolean) as string[];

    const strategy: StrategyBrief = {
      icpName: this.readString(strategySource.icpName) ?? lead.client.displayName ?? lead.client.legalName,
      campaignName: this.readString(strategySource.campaignName) ?? lead.campaign.name,
      objective: this.readString(strategySource.objective) ?? lead.campaign.objective ?? 'Book qualified meetings with decision makers',
      offerSummary: this.readString(strategySource.offerSummary) ?? lead.campaign.offerSummary ?? lead.client.outboundOffer ?? 'Structured outbound outreach and follow-up automation',
      industryTags: Array.from(new Set(industryTags)).slice(0, 6),
      geoTargets: Array.from(new Set(geoTargets.filter(Boolean))).slice(0, 8),
      titleKeywords: this.readStringArray(strategySource.titleKeywords).length ? this.readStringArray(strategySource.titleKeywords) : [lead.contact?.title ?? 'Decision maker'],
      exclusionKeywords: this.readStringArray(strategySource.exclusionKeywords),
      painPoints: this.readStringArray(strategySource.painPoints).length
        ? this.readStringArray(strategySource.painPoints)
        : this.derivePainPoints(lead.client.outboundOffer, lead.account?.industry ?? lead.client.industry),
      valueAngles: this.readStringArray(strategySource.valueAngles).length
        ? this.readStringArray(strategySource.valueAngles)
        : this.deriveValueAngles(lead.client.outboundOffer),
      tone: this.readString(strategySource.tone) ?? 'professional-direct',
      callToAction: this.readString(strategySource.callToAction) ?? 'Book a meeting',
      bookingUrlOverride: lead.campaign.bookingUrlOverride ?? lead.client.bookingUrl ?? undefined,
      segmentNotes: [
        `Sequence step: ${input.stepOrderIndex}`,
        `Job type: ${input.jobType}`,
        input.note?.trim() || null,
      ].filter(Boolean).join(' | '),
    };

    const candidate: LeadCandidate = {
      companyName: lead.account?.companyName ?? lead.contact?.fullName ?? 'Prospect account',
      domain: lead.account?.domain ?? undefined,
      industry: lead.account?.industry ?? lead.client.industry ?? undefined,
      employeeCount: lead.account?.employeeCount ?? undefined,
      contactFullName: lead.contact?.fullName ?? 'Decision maker',
      firstName: lead.contact?.firstName ?? undefined,
      lastName: lead.contact?.lastName ?? undefined,
      title: lead.contact?.title ?? 'Decision maker',
      email: lead.contact?.email ?? undefined,
      linkedinUrl: lead.contact?.linkedinUrl ?? undefined,
      city: lead.contact?.city ?? lead.account?.city ?? undefined,
      region: lead.contact?.region ?? lead.account?.region ?? undefined,
      countryCode: lead.contact?.countryCode ?? lead.account?.countryCode ?? undefined,
      timezone: lead.contact?.timezone ?? undefined,
      reasonForFit: this.buildReasonForFit(lead, strategy, input.note),
      qualificationNotes: input.note?.trim() || undefined,
      priority: lead.priority,
    };

    try {
      const draft = await this.writerAgent.generate(strategy, candidate);
      return { strategy, candidate, draft };
    } catch {
      return {
        strategy,
        candidate,
        draft: {
          subject: `${lead.client.displayName} for ${candidate.companyName}`.slice(0, 140),
          body: [
            `Hi ${candidate.firstName || candidate.contactFullName.split(' ')[0] || 'there'},`,
            '',
            `I’m reaching out from ${lead.client.displayName}.`,
            candidate.reasonForFit,
            '',
            strategy.valueAngles[0] ?? strategy.offerSummary,
            '',
            strategy.callToAction === 'Book a meeting' && strategy.bookingUrlOverride
              ? `If useful, here is the booking link: ${strategy.bookingUrlOverride}`
              : 'If this is relevant, happy to share a few concrete next steps.',
            '',
            'Best,',
            lead.client.displayName,
          ].join('\n'),
          tone: strategy.tone,
          intent: input.jobType,
        },
      };
    }
  }

  private buildReasonForFit(lead: any, strategy: StrategyBrief, note?: string) {
    const parts = [
      note?.trim() || null,
      lead.account?.companyName ? `${lead.account.companyName} appears aligned with ${strategy.objective.toLowerCase()}.` : null,
      strategy.painPoints[0] ? `One likely friction point is ${strategy.painPoints[0].toLowerCase()}.` : null,
      strategy.valueAngles[0] ? `We help through ${strategy.valueAngles[0].toLowerCase()}.` : null,
    ].filter(Boolean);
    return parts.join(' ');
  }


  private readStoredStrategy(value: Prisma.JsonValue | null | undefined): StrategyBrief | null {
    const metadata = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
    const raw = metadata.strategy && typeof metadata.strategy === 'object' && !Array.isArray(metadata.strategy)
      ? (metadata.strategy as Record<string, unknown>)
      : metadata;
    if (!raw || !Object.keys(raw).length) {
      return null;
    }
    return this.normalizeStrategyBrief(raw, {
      icpName: 'Ideal customer profile',
      campaignName: 'Campaign',
      objective: 'Book qualified meetings with decision makers',
      offerSummary: 'Structured outbound outreach and follow-up automation',
      industryTags: [],
      geoTargets: [],
      titleKeywords: ['Decision maker'],
      exclusionKeywords: [],
      painPoints: this.derivePainPoints(undefined, undefined),
      valueAngles: this.deriveValueAngles(undefined),
      tone: 'professional-direct',
      callToAction: 'Book a meeting',
      bookingUrlOverride: undefined,
      segmentNotes: undefined,
    });
  }

  private normalizeStrategyBrief(
    value: unknown,
    fallback: {
      icpName: string;
      campaignName: string;
      objective: string;
      offerSummary: string;
      industryTags: string[];
      geoTargets: string[];
      titleKeywords: string[];
      exclusionKeywords: string[];
      painPoints: string[];
      valueAngles: string[];
      tone: string;
      callToAction: string;
      bookingUrlOverride?: string;
      segmentNotes?: string;
    },
  ): StrategyBrief {
    const raw =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return {
      icpName: this.readString(raw.icpName) ?? fallback.icpName,
      campaignName: this.readString(raw.campaignName) ?? fallback.campaignName,
      objective: this.readString(raw.objective) ?? fallback.objective,
      offerSummary: this.readString(raw.offerSummary) ?? fallback.offerSummary,
      industryTags: this.uniqueStringArray([
        ...this.readStringArray(raw.industryTags),
        ...fallback.industryTags,
      ]).slice(0, 6),
      geoTargets: this.uniqueStringArray([
        ...this.readStringArray(raw.geoTargets),
        ...fallback.geoTargets,
      ]).slice(0, 8),
      titleKeywords: this.uniqueStringArray([
        ...this.readStringArray(raw.titleKeywords),
        ...fallback.titleKeywords,
      ]).slice(0, 8),
      exclusionKeywords: this.uniqueStringArray([
        ...this.readStringArray(raw.exclusionKeywords),
        ...fallback.exclusionKeywords,
      ]).slice(0, 8),
      painPoints: this.uniqueStringArray([
        ...this.readStringArray(raw.painPoints),
        ...fallback.painPoints,
      ]).slice(0, 6),
      valueAngles: this.uniqueStringArray([
        ...this.readStringArray(raw.valueAngles),
        ...fallback.valueAngles,
      ]).slice(0, 6),
      tone: this.readString(raw.tone) ?? fallback.tone,
      callToAction: this.readString(raw.callToAction) ?? fallback.callToAction,
      bookingUrlOverride: this.readString(raw.bookingUrlOverride) ?? fallback.bookingUrlOverride,
      segmentNotes: this.readString(raw.segmentNotes) ?? fallback.segmentNotes,
    };
  }

  private uniqueStringArray(values: Array<string | undefined>) {
    return Array.from(new Set(values.map((item) => item?.trim() ?? '').filter(Boolean)));
  }

  private derivePainPoints(offer?: string | null, industry?: string | null) {
    const industryLabel = industry?.trim() || 'your market';
    return [
      `inconsistent lead flow in ${industryLabel}`,
      'manual follow-up slowing conversions',
      'booked meetings getting lost between outreach and response handling',
      offer?.trim() ? `low visibility into whether ${offer.trim()} is producing meetings` : null,
    ].filter(Boolean) as string[];
  }

  private deriveValueAngles(offer?: string | null) {
    return [
      offer?.trim() || 'a structured outbound system',
      'consistent follow-up without manual chasing',
      'clean handoff from reply to meeting',
    ].filter(Boolean) as string[];
  }

  private readString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length ? normalized : undefined;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : typeof item === 'object' && item ? String((item as Record<string, unknown>).label ?? (item as Record<string, unknown>).code ?? '').trim() : ''))
      .filter(Boolean);
  }

  async generateGrowthMessages(input: GenerateGrowthMessagesDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: {
        id: true,
        organizationId: true,
        legalName: true,
        displayName: true,
        websiteUrl: true,
        bookingUrl: true,
        outboundOffer: true,
      },
    });

    const campaign = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
      select: {
        id: true,
        name: true,
        clientId: true,
        workflowRunId: true,
        metadataJson: true,
      },
    });

    const strategy = this.readStoredStrategy(campaign.metadataJson);

    if (!strategy) {
      return {
        ok: false,
        message: 'Campaign strategy metadata is missing. Activate growth workspace first.',
      };
    }

    const workflowRunId = campaign.workflowRunId ?? input.workflowRunId ?? null;
    if (!workflowRunId) {
      return {
        ok: false,
        message: 'No workflowRunId is available for this campaign.',
      };
    }

    let generated = 0;

    for (const lead of input.leads) {
      const candidate: LeadCandidate = {
        companyName: lead.company ?? 'Unknown company',
        contactFullName: lead.label ?? 'Unknown contact',
        title: lead.role ?? 'Decision maker',
        reasonForFit: 'Regenerated from campaign context',
      };

      const draft = await this.writerAgent.generate(strategy, candidate);

      await this.prisma.outreachMessage.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          leadId: lead.id,
          workflowRunId,
          direction: MessageDirection.OUTBOUND,
          channel: MessageChannel.EMAIL,
          status: MessageStatus.QUEUED,
          source: RecordSource.AI_GENERATED,
          lifecycle: MessageLifecycle.DRAFT,
          subjectLine: draft.subject,
          bodyText: draft.body,
          metadataJson: {
            tone: draft.tone,
            intent: draft.intent,
            regenerated: true,
          },
        },
      });

      generated += 1;
    }

    await this.prisma.activityEvent.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        campaignId: campaign.id,
        workflowRunId,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'campaign',
        subjectId: campaign.id,
        summary: `${generated} messages generated`,
        metadataJson: { count: generated },
      },
    });

    return {
      ok: true,
      workflowRunId,
      campaignId: campaign.id,
      generatedCount: generated,
    };
  }

  async generateGrowthSequence(input: GenerateGrowthSequenceDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: {
        id: true,
        organizationId: true,
      },
    });

    const campaign = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
      select: {
        id: true,
        name: true,
        workflowRunId: true,
        metadataJson: true,
      },
    });

    const strategy = this.readStoredStrategy(campaign.metadataJson);

    if (!strategy) {
      return {
        ok: false,
        message: 'Campaign strategy metadata is missing. Activate growth workspace first.',
      };
    }

    const stepCount = input.context?.desiredStepCount ?? 3;
    const steps = await this.sequenceAgent.generate(strategy, stepCount);
    const workflowRunId = campaign.workflowRunId ?? input.workflowRunId ?? null;

    const sequence = await this.prisma.sequence.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        campaignId: campaign.id,
        workflowRunId: workflowRunId ?? undefined,
        name: `${campaign.name} regenerated sequence`,
        status: SequenceStatus.DRAFT,
        source: RecordSource.AI_GENERATED,
        description: input.context?.offer ?? null,
      },
      select: { id: true },
    });

    for (const step of steps) {
      await this.prisma.sequenceStep.create({
        data: {
          sequenceId: sequence.id,
          orderIndex: step.orderIndex,
          type: SequenceStepType.EMAIL,
          status: SequenceStepStatus.ACTIVE,
          waitDays: step.waitDays,
          subjectTemplate: step.subjectTemplate ?? null,
          bodyTemplate: step.bodyTemplate ?? null,
          instructionText: step.instructionText ?? null,
        },
      });
    }

    if (workflowRunId) {
      await this.prisma.activityEvent.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          campaignId: campaign.id,
          workflowRunId,
          kind: ActivityKind.NOTE_ADDED,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'campaign',
          subjectId: campaign.id,
          summary: `Sequence generated with ${steps.length} steps`,
          metadataJson: { sequenceId: sequence.id, count: steps.length },
        },
      });
    }

    return {
      ok: true,
      workflowRunId,
      campaignId: campaign.id,
      sequenceId: sequence.id,
      stepCount: steps.length,
    };
  }

  async generateReminder(input: GenerateReminderDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: { id: true, organizationId: true, legalName: true, displayName: true },
    });

    const clientName = client.displayName || client.legalName;

    const workflow = await this.workflows.createWorkflowRun({
      clientId: client.id,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.REMINDER_DISPATCH,
      status: WorkflowStatus.COMPLETED,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.AI_GENERATED,
      title: `Reminder draft for ${clientName}`,
      inputJson: {
        clientId: input.clientId,
        context: input.context,
      },
      contextJson: {
        initiatedBy: 'ai.controller',
        endpoint: 'POST /v1/ai/revenue/reminder/generate',
      },
      resultJson: { kind: 'REMINDER_DRAFT' },
      completedAt: new Date(),
    });

    const amountText =
      typeof input.context?.amount === 'number'
        ? `$${input.context.amount.toFixed(2)}`
        : 'the outstanding balance';

    const dueDateText = input.context?.dueDate ?? 'the due date on file';

    const subject = 'Friendly reminder regarding your invoice';
    const body = [
      'Hello,',
      '',
      `This is a reminder regarding invoice ${input.context?.invoiceId ?? ''}`.trim(),
      `Our records show ${amountText} is pending, with reference to ${dueDateText}.`,
      'Please review and arrange payment at your earliest convenience.',
      '',
      'Thank you.',
    ].join('\n');

    await this.prisma.activityEvent.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        workflowRunId: workflow.id,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'revenue_reminder',
        subjectId: workflow.id,
        summary: 'Reminder draft generated',
        metadataJson: {
          invoiceId: input.context?.invoiceId ?? null,
        },
      },
    });

    return {
      workflowRunId: workflow.id,
      kind: 'REMINDER_DRAFT',
      subject,
      body,
      context: input.context,
    };
  }

  async generateAgreementDraft(input: GenerateAgreementDraftDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: { id: true, organizationId: true, legalName: true, displayName: true },
    });

    const clientName = client.displayName || client.legalName;

    const workflow = await this.workflows.createWorkflowRun({
      clientId: client.id,
      lane: WorkflowLane.DOCUMENTS,
      type: WorkflowType.AGREEMENT_ISSUANCE,
      status: WorkflowStatus.COMPLETED,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.AI_GENERATED,
      title: `Agreement draft for ${clientName}`,
      inputJson: {
        clientId: input.clientId,
        context: input.context,
      },
      contextJson: {
        initiatedBy: 'ai.controller',
        endpoint: 'POST /v1/ai/revenue/agreement/generate-draft',
      },
      resultJson: { kind: 'AGREEMENT_DRAFT' },
      completedAt: new Date(),
    });

    const draft = [
      'Service Agreement Draft',
      '',
      `Client: ${clientName}`,
      `Service: ${input.context.service}`,
      '',
      'Scope',
      input.context.terms ??
        'The parties agree to the service scope and delivery boundaries as defined in the client profile and active service configuration.',
      '',
      'Performance',
      'Services will be delivered according to the active workflow, plan limits, and operational availability defined in Orchestrate.',
      '',
      'Commercial Terms',
      'Billing, invoices, receipts, reminders, and statements remain governed by the active subscription and issued financial records.',
    ].join('\n');

    await this.prisma.activityEvent.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        workflowRunId: workflow.id,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'agreement_draft',
        subjectId: workflow.id,
        summary: 'Agreement draft generated',
        metadataJson: {
          service: input.context.service,
        },
      },
    });

    return {
      workflowRunId: workflow.id,
      kind: 'AGREEMENT_DRAFT',
      title: `Agreement draft for ${input.context.service}`,
      body: draft,
      context: input.context,
    };
  }

  async generateStatementSummary(input: GenerateStatementSummaryDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: { id: true, organizationId: true, legalName: true, displayName: true },
    });

    const clientName = client.displayName || client.legalName;

    const workflow = await this.workflows.createWorkflowRun({
      clientId: client.id,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.STATEMENT_ISSUANCE,
      status: WorkflowStatus.COMPLETED,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.AI_GENERATED,
      title: `Statement summary for ${clientName}`,
      inputJson: {
        clientId: input.clientId,
        context: input.context,
      },
      contextJson: {
        initiatedBy: 'ai.controller',
        endpoint: 'POST /v1/ai/revenue/statement/generate-summary',
      },
      resultJson: { kind: 'STATEMENT_SUMMARY' },
      completedAt: new Date(),
    });

    const summary = [
      'Statement Summary',
      '',
      `Client: ${clientName}`,
      `Period: ${input.context.period}`,
      '',
      'This summary reflects the financial activity recorded for the selected period, including issued invoices, posted payments, receipts, and any outstanding balances still open at statement close.',
      input.context.summaryData
        ? 'Additional reference data has been attached in structured form for review.'
        : 'No additional summary data was provided with this request.',
    ].join('\n');

    await this.prisma.activityEvent.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        workflowRunId: workflow.id,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'statement_summary',
        subjectId: workflow.id,
        summary: 'Statement summary generated',
        metadataJson: {
          period: input.context.period,
        },
      },
    });

    return {
      workflowRunId: workflow.id,
      kind: 'STATEMENT_SUMMARY',
      title: `Statement summary for ${input.context.period}`,
      body: summary,
      context: input.context,
    };
  }
}