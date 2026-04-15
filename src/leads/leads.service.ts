import { NotFoundException, Injectable } from '@nestjs/common';
import {
  ActivityVisibility,
  JobType,
  LeadQualificationState,
  LeadSourceType,
  LeadStatus,
  Prisma,
  RecordSource,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { buildPagination } from '../common/utils/pagination';
import { PrismaService } from '../database/prisma.service';
import { ExecutionService } from '../execution/execution.service';
import { QueueLeadSendDto } from '../execution/dto/queue-lead-send.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executionService: ExecutionService,
  ) {}

  async create(dto: CreateLeadDto) {
    if (!dto.organizationId) {
      throw new Error('organizationId is required');
    }
    if (!dto.clientId) {
      throw new Error('clientId is required');
    }
    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: {
          id: dto.campaignId,
          organizationId: dto.organizationId,
          clientId: dto.clientId,
        },
        select: {
          id: true,
          workflowRunId: true,
          generationState: true,
        },
      });

      if (!campaign) {
        throw new NotFoundException('Campaign not found in the active client workspace');
      }

      let accountId = dto.accountId;
      let contactId = dto.contactId;
      let leadSourceId = dto.leadSourceId;
      const workflowRunId = campaign?.workflowRunId ?? null;
      const recordSource = this.resolveLeadRecordSource(dto.sourceType);
      const qualificationState = this.resolveQualificationState(dto.status);

      if (!accountId && dto.companyName) {
        const account = await tx.account.create({
          data: {
            organizationId: dto.organizationId!,
            clientId: dto.clientId!,
            companyName: dto.companyName,
            domain: dto.domain,
            industry: dto.industry,
            employeeCount: dto.employeeCount,
            city: dto.city,
            region: dto.region,
            countryCode: dto.countryCode,
            websiteUrl: dto.websiteUrl,
            linkedinUrl: dto.linkedinUrl,
          },
        });
        accountId = account.id;
      }

      if (!contactId && (dto.fullName || dto.email)) {
        const contact = await tx.contact.create({
          data: {
            organizationId: dto.organizationId!,
            clientId: dto.clientId!,
            accountId,
            fullName:
              dto.fullName || [dto.firstName, dto.lastName].filter(Boolean).join(' ') || dto.email || 'Unnamed Contact',
            firstName: dto.firstName,
            lastName: dto.lastName,
            title: dto.title,
            email: dto.email,
            phone: dto.phone,
            linkedinUrl: dto.linkedinUrl,
            timezone: dto.timezone,
            city: dto.city,
            region: dto.region,
            countryCode: dto.countryCode,
          },
        });
        contactId = contact.id;
      }

      if (!leadSourceId && dto.sourceName && dto.sourceType) {
        const leadSource = await tx.leadSource.create({
          data: {
            organizationId: dto.organizationId!,
            clientId: dto.clientId!,
            campaignId: dto.campaignId,
            workflowRunId,
            name: dto.sourceName,
            type: dto.sourceType,
            source: recordSource,
            sourceRef: dto.sourceRef,
            importedAt: new Date(),
          },
        });
        leadSourceId = leadSource.id;
      }

      const lead = await tx.lead.create({
        data: {
          organizationId: dto.organizationId!,
          clientId: dto.clientId!,
          campaignId: dto.campaignId,
          accountId,
          contactId,
          leadSourceId,
          workflowRunId,
          status: dto.status,
          source: recordSource,
          qualificationState,
          priority: dto.priority,
          score: dto.score == null ? undefined : new Prisma.Decimal(dto.score),
          metadataJson: toPrismaJson(dto.metadataJson),
        },
        include: {
          account: true,
          contact: true,
          leadSource: true,
          campaign: true,
        },
      });

      await tx.activityEvent.create({
        data: {
          organizationId: dto.organizationId!,
          clientId: dto.clientId!,
          campaignId: dto.campaignId,
          workflowRunId,
          kind: 'LEAD_IMPORTED',
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'lead',
          subjectId: lead.id,
          summary: `Lead ${lead.id} added`,
          metadataJson: {
            leadId: lead.id,
            workflowRunId,
            source: recordSource,
            qualificationState,
          } as Prisma.InputJsonValue,
        },
      });

      if (campaign?.id && (!campaign.generationState || campaign.generationState === 'INIT' || campaign.generationState === 'TARGETING_READY')) {
        await tx.campaign.update({
          where: { id: campaign.id },
          data: {
            generationState: 'LEADS_READY',
          },
        });
      }

      return lead;
    });
  }

  async list(query: ListLeadsDto) {
    const { page, limit, skip, take } = buildPagination(query.page, query.limit);
    const where = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.status ? { status: query.status as LeadStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { contact: { fullName: { contains: query.search, mode: 'insensitive' as const } } },
              { contact: { email: { contains: query.search, mode: 'insensitive' as const } } },
              { account: { companyName: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: {
          account: true,
          contact: true,
          campaign: true,
          leadSource: true,
          workflowRun: true,
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  async assertLeadAccessible(organizationId: string, clientId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId, clientId },
      select: { id: true },
    });
    if (!lead) {
      throw new NotFoundException('Lead not found in the active client workspace');
    }
    return lead;
  }

  async launchTestSend(leadId: string) {
    return this.executionService.runImmediateSendForLead(leadId, {
      jobType: JobType.FIRST_SEND,
      note: 'manual test-send endpoint',
      simulateDeliveryOnly: false,
    });
  }

  async queueFirstSend(leadId: string, dto: QueueLeadSendDto) {
    return this.executionService.queueLeadSend(leadId, {
      ...dto,
      jobType: JobType.FIRST_SEND,
    });
  }

  async queueFollowUp(leadId: string, dto: QueueLeadSendDto) {
    return this.executionService.queueLeadSend(leadId, {
      ...dto,
      jobType: JobType.FOLLOWUP_SEND,
    });
  }

  private resolveLeadRecordSource(sourceType?: LeadSourceType): RecordSource {
    switch (sourceType) {
      case LeadSourceType.CSV_IMPORT:
      case LeadSourceType.GOOGLE_MAPS:
      case LeadSourceType.DIRECTORY:
      case LeadSourceType.API:
      case LeadSourceType.REFERRAL:
        return RecordSource.IMPORTED;
      case LeadSourceType.INTERNAL_GROWTH:
        return RecordSource.AI_GENERATED;
      case LeadSourceType.MANUAL:
      case LeadSourceType.OTHER:
      default:
        return RecordSource.USER_CREATED;
    }
  }

  private resolveQualificationState(status?: LeadStatus): LeadQualificationState | undefined {
    switch (status) {
      case LeadStatus.NEW:
      case LeadStatus.ENRICHED:
        return LeadQualificationState.DISCOVERED;
      case LeadStatus.QUALIFIED:
        return LeadQualificationState.QUALIFIED;
      case LeadStatus.CONTACTED:
      case LeadStatus.FOLLOWED_UP:
        return LeadQualificationState.CONTACTED;
      case LeadStatus.REPLIED:
        return LeadQualificationState.REPLIED;
      case LeadStatus.INTERESTED:
      case LeadStatus.HANDOFF_PENDING:
        return LeadQualificationState.INTERESTED;
      case LeadStatus.BOOKED:
        return LeadQualificationState.CONVERTED;
      case LeadStatus.CLOSED_LOST:
      case LeadStatus.SUPPRESSED:
        return LeadQualificationState.DISQUALIFIED;
      default:
        return undefined;
    }
  }
}
