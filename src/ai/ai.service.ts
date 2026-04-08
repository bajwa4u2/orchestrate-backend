import { Injectable } from '@nestjs/common';
import {
  ActivityKind,
  CampaignStatus,
  LeadSourceType,
  LeadStatus,
  MessageChannel,
  MessageDirection,
  MessageStatus,
  Prisma,
  SegmentStatus,
  SequenceStatus,
  SequenceStepStatus,
  SequenceStepType,
  ICPStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { LeadAgent } from './agents/lead.agent';
import { SequenceAgent } from './agents/sequence.agent';
import { StrategyAgent } from './agents/strategy.agent';
import { WriterAgent } from './agents/writer.agent';
import { LeadCandidate } from './contracts/lead.contract';
import { ServiceProfileInput } from './contracts/service-profile.contract';
import { StrategyBrief } from './contracts/strategy.contract';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyAgent: StrategyAgent,
    private readonly leadAgent: LeadAgent,
    private readonly writerAgent: WriterAgent,
    private readonly sequenceAgent: SequenceAgent,
  ) {}

  async buildStrategy(input: ServiceProfileInput): Promise<StrategyBrief> {
    return this.strategyAgent.generate(input);
  }

  async generateLeadCandidates(input: ServiceProfileInput, leadCount?: number): Promise<LeadCandidate[]> {
    const strategy = await this.buildStrategy(input);
    return this.leadAgent.generate(strategy, this.resolveLeadCount(leadCount ?? input.maxLeads));
  }

  async activateGrowthWorkspace(input: ServiceProfileInput) {
    const strategy = await this.strategyAgent.generate(input);
    const leadCount = this.resolveLeadCount(input.maxLeads);
    const sequenceStepCount = this.resolveStepCount(input.sequenceStepCount);
    const leads = await this.leadAgent.generate(strategy, leadCount);
    const sequenceSteps = await this.sequenceAgent.generate(strategy, sequenceStepCount);
    const messageDrafts = await Promise.all(
      leads.map(async (candidate) => ({
        candidate,
        draft: await this.writerAgent.generate(strategy, candidate),
      })),
    );

    return this.prisma.$transaction(async (tx) => {
      const icp = await tx.idealCustomerProfile.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          name: strategy.icpName,
          status: ICPStatus.ACTIVE,
          industryTags: strategy.industryTags,
          geoTargets: strategy.geoTargets,
          titleKeywords: strategy.titleKeywords,
          exclusionKeywords: strategy.exclusionKeywords,
          rulesJson: toPrismaJson({
            painPoints: strategy.painPoints,
            valueAngles: strategy.valueAngles,
            callToAction: strategy.callToAction,
            tone: strategy.tone,
            bookingUrlOverride: strategy.bookingUrlOverride,
          }),
        },
      });

      const segment = await tx.segment.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          icpId: icp.id,
          name: `${strategy.icpName} Segment`,
          status: SegmentStatus.ACTIVE,
          filterJson: toPrismaJson({
            geoTargets: strategy.geoTargets,
            titleKeywords: strategy.titleKeywords,
            exclusionKeywords: strategy.exclusionKeywords,
            buyerIndustries: input.buyerIndustries ?? [input.industry],
          }),
          notesText: strategy.segmentNotes,
        },
      });

      const campaign = await tx.campaign.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          icpId: icp.id,
          segmentId: segment.id,
          createdById: input.createdById,
          name: strategy.campaignName,
          status: CampaignStatus.READY,
          channel: MessageChannel.EMAIL,
          objective: strategy.objective,
          offerSummary: strategy.offerSummary,
          bookingUrlOverride: strategy.bookingUrlOverride,
          dailySendCap: input.dailySendCap ?? 20,
          metadataJson: toPrismaJson({
            serviceProfile: {
              businessName: input.businessName,
              offerName: input.offerName,
              desiredOutcome: input.desiredOutcome,
            },
            strategy,
          }),
        },
      });

      const leadSource = await tx.leadSource.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: campaign.id,
          name: 'AI Generated Lead Pool',
          type: LeadSourceType.INTERNAL_GROWTH,
          configJson: toPrismaJson({
            generator: 'openai',
            model: 'gpt-4o-mini',
            generatedLeadCount: leads.length,
          }),
          importedAt: new Date(),
        },
      });

      const sequence = await tx.sequence.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: campaign.id,
          name: `${strategy.campaignName} Sequence`,
          status: SequenceStatus.DRAFT,
          description: `AI-generated sequence for ${strategy.campaignName}`,
        },
      });

      const normalizedSteps = this.normalizeSequenceSteps(sequenceSteps);
      const stepRecords = [] as { id: string; orderIndex: number }[];
      for (const step of normalizedSteps) {
        const record = await tx.sequenceStep.create({
          data: {
            sequenceId: sequence.id,
            orderIndex: step.orderIndex,
            type: SequenceStepType.EMAIL,
            status: SequenceStepStatus.ACTIVE,
            waitDays: step.waitDays,
            subjectTemplate: step.subjectTemplate,
            bodyTemplate: step.bodyTemplate,
            instructionText: step.instructionText,
            variantPolicyJson: toPrismaJson({ generator: 'ai' }),
          },
        });
        stepRecords.push({ id: record.id, orderIndex: record.orderIndex });
      }

      const firstStep = stepRecords[0] ?? null;
      const createdLeads = [] as { leadId: string; contactFullName: string; companyName: string; email?: string }[];

      for (const generated of messageDrafts) {
        const candidate = generated.candidate;
        const account = await tx.account.create({
          data: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            companyName: candidate.companyName,
            domain: candidate.domain,
            industry: candidate.industry,
            employeeCount: candidate.employeeCount,
            city: candidate.city,
            region: candidate.region,
            countryCode: candidate.countryCode,
          },
        });

        const contact = await tx.contact.create({
          data: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            accountId: account.id,
            fullName: candidate.contactFullName,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            title: candidate.title,
            email: candidate.email,
            linkedinUrl: candidate.linkedinUrl,
            timezone: candidate.timezone,
            city: candidate.city,
            region: candidate.region,
            countryCode: candidate.countryCode,
          },
        });

        const lead = await tx.lead.create({
          data: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            campaignId: campaign.id,
            leadSourceId: leadSource.id,
            accountId: account.id,
            contactId: contact.id,
            status: LeadStatus.NEW,
            priority: candidate.priority ?? 50,
            metadataJson: toPrismaJson({
              reasonForFit: candidate.reasonForFit,
              qualificationNotes: candidate.qualificationNotes,
              generatedBy: 'ai',
            }),
          },
        });

        createdLeads.push({
          leadId: lead.id,
          contactFullName: candidate.contactFullName,
          companyName: candidate.companyName,
          email: candidate.email,
        });

        if (firstStep) {
          const messageDraft = generated.draft;

          await tx.outreachMessage.create({
            data: {
              organizationId: input.organizationId,
              clientId: input.clientId,
              campaignId: campaign.id,
              leadId: lead.id,
              sequenceStepId: firstStep.id,
              direction: MessageDirection.OUTBOUND,
              channel: MessageChannel.EMAIL,
              status: MessageStatus.QUEUED,
              subjectLine: messageDraft.subject,
              bodyText: messageDraft.body,
              metadataJson: toPrismaJson({
                generatedBy: 'ai',
                tone: messageDraft.tone,
                intent: messageDraft.intent,
              }),
            },
          });
        }
      }

      await tx.activityEvent.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: campaign.id,
          actorUserId: input.createdById,
          kind: ActivityKind.CAMPAIGN_CREATED,
          subjectType: 'campaign',
          subjectId: campaign.id,
          summary: `AI prepared campaign ${campaign.name}`,
          metadataJson: {
            generatedLeadCount: createdLeads.length,
            sequenceStepCount: stepRecords.length,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        strategy,
        campaign,
        icp,
        segment,
        leadSource,
        sequence,
        leads: createdLeads,
        sequenceSteps: stepRecords,
      };
    });
  }

  private resolveLeadCount(value?: number) {
    const candidate = value ?? 12;
    return Math.max(1, Math.min(candidate, 50));
  }

  private resolveStepCount(value?: number) {
    const candidate = value ?? 3;
    return Math.max(2, Math.min(candidate, 5));
  }

  private normalizeSequenceSteps(
    steps: Array<{
      orderIndex: number;
      waitDays: number;
      subjectTemplate?: string;
      bodyTemplate?: string;
      instructionText?: string;
    }>,
  ) {
    const valid = steps
      .filter((step) => Number.isFinite(step.orderIndex))
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .slice(0, 5);

    if (valid.length > 0) {
      return valid;
    }

    return [
      {
        orderIndex: 1,
        waitDays: 0,
        subjectTemplate: 'Quick note',
        bodyTemplate: 'Reaching out with a concise idea that may be relevant.',
        instructionText: 'Initial outreach email.',
      },
      {
        orderIndex: 2,
        waitDays: 3,
        subjectTemplate: 'Following up',
        bodyTemplate: 'Following up in case this is relevant this quarter.',
        instructionText: 'Short follow-up.',
      },
      {
        orderIndex: 3,
        waitDays: 7,
        subjectTemplate: 'Final check-in',
        bodyTemplate: 'Leaving one final note in case timing is better later.',
        instructionText: 'Final follow-up.',
      },
    ];
  }
}
