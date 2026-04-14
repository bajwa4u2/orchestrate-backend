import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Job, JobStatus, JobType, LeadQualificationState, LeadStatus, Prisma, RecordSource } from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { AiService } from '../../ai/ai.service';
import { PrismaService } from '../../database/prisma.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class LeadImportWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.LEAD_IMPORT];

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const campaignId = this.readString(context.payload.campaignId) ?? job.campaignId;
    if (!campaignId) {
      throw new BadRequestException(`Job ${job.id} is missing campaignId`);
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { client: true },
    });
    if (!campaign) {
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    }

    const existingSendableLeads = await this.prisma.lead.findMany({
      where: {
        campaignId: campaign.id,
        status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] },
        contact: { email: { not: null } },
      },
      select: { id: true },
      take: 25,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    let createdLeadIds: string[] = [];
    if (!existingSendableLeads.length) {
      createdLeadIds = await this.bootstrapLeadsFromClientAssets({
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        workflowRunId: context.workflowRunId,
      });
    }

    const candidateLeadIds = [...existingSendableLeads.map((item) => item.id), ...createdLeadIds].slice(0, 25);

    const queuedMessageGenerationJobIds: string[] = [];
    for (const leadId of candidateLeadIds) {
      const dedupeKey = `first_send:${leadId}`;
      const existing = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED] },
        },
        select: { id: true },
      });
      if (existing) continue;

      const firstSendJob = await this.prisma.job.create({
        data: {
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          campaignId: campaign.id,
          type: JobType.FIRST_SEND,
          status: JobStatus.QUEUED,
          queueName: 'outreach',
          dedupeKey,
          scheduledFor: new Date(),
          maxAttempts: 3,
          payloadJson: toPrismaJson({
            leadId,
            workflowRunId: context.workflowRunId,
            note: 'automatic launch from lead import worker',
          }),
        },
      });
      queuedMessageGenerationJobIds.push(firstSendJob.id);
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: candidateLeadIds.length ? 'ACTIVE' : 'READY',
        generationState: candidateLeadIds.length ? 'ACTIVE' : 'TARGETING_READY',
        metadataJson: toPrismaJson({
          ...this.asObject(campaign.metadataJson),
          activation: {
            lastBootstrapAt: new Date().toISOString(),
            bootstrapStatus: candidateLeadIds.length ? 'launch_queued' : 'awaiting_lead_source',
            createdLeadCount: createdLeadIds.length,
            queuedFirstSendCount: queuedMessageGenerationJobIds.length,
          },
        }),
      },
    });

    return {
      ok: true,
      campaignId: campaign.id,
      createdLeadCount: createdLeadIds.length,
      queuedFirstSendCount: queuedMessageGenerationJobIds.length,
      queuedJobIds: queuedMessageGenerationJobIds,
      waitingForLeadSource: candidateLeadIds.length === 0,
    };
  }

  private async bootstrapLeadsFromClientAssets(input: {
    organizationId: string;
    clientId: string;
    campaignId: string;
    workflowRunId?: string;
  }) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        email: { not: null },
      },
      include: {
        account: true,
        leads: {
          where: { campaignId: input.campaignId },
          select: { id: true },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 25,
    });

    const createdLeadIds: string[] = [];

    for (const contact of contacts) {
      if (contact.leads.length) continue;
      const lead = await this.prisma.lead.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: input.campaignId,
          accountId: contact.accountId ?? undefined,
          contactId: contact.id,
          workflowRunId: input.workflowRunId,
          status: LeadStatus.NEW,
          source: RecordSource.IMPORTED,
          qualificationState: LeadQualificationState.DISCOVERED,
          priority: 50,
          metadataJson: toPrismaJson({ source: 'existing_contact' }),
        },
      });
      createdLeadIds.push(lead.id);
    }

    if (createdLeadIds.length) {
      return createdLeadIds;
    }

    const client = await this.prisma.client.findUnique({
      where: { id: input.clientId },
      select: { metadataJson: true, scopeJson: true, industry: true },
    });
    const metadata = this.asObject(client?.metadataJson);
    const setup = this.asObject(metadata.setup);
    const scope = this.asObject(client?.scopeJson);
    const seedProspects = this.readSeedProspects(setup.seedProspects ?? metadata.seedProspects ?? scope.seedProspects);

    for (const prospect of seedProspects.slice(0, 25)) {
      const existing = await this.prisma.contact.findFirst({
        where: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          email: prospect.email,
        },
        select: { id: true, accountId: true },
      });

      let accountId = existing?.accountId ?? null;
      let contactId = existing?.id ?? null;

      if (!accountId && prospect.companyName) {
        const account = await this.prisma.account.create({
          data: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            companyName: prospect.companyName,
            domain: prospect.domain,
            industry: prospect.industry ?? client?.industry ?? undefined,
            city: prospect.city,
            region: prospect.region,
            countryCode: prospect.countryCode,
            websiteUrl: prospect.websiteUrl,
            linkedinUrl: prospect.linkedinUrl,
          },
        });
        accountId = account.id;
      }

      if (!contactId) {
        const contact = await this.prisma.contact.create({
          data: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            accountId: accountId ?? undefined,
            fullName: prospect.fullName,
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            title: prospect.title,
            email: prospect.email,
            phone: prospect.phone,
            linkedinUrl: prospect.linkedinUrl,
            timezone: prospect.timezone,
            city: prospect.city,
            region: prospect.region,
            countryCode: prospect.countryCode,
          },
        });
        contactId = contact.id;
      }

      const lead = await this.prisma.lead.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: input.campaignId,
          accountId: accountId ?? undefined,
          contactId: contactId ?? undefined,
          workflowRunId: input.workflowRunId,
          status: LeadStatus.NEW,
          source: RecordSource.IMPORTED,
          qualificationState: LeadQualificationState.DISCOVERED,
          priority: prospect.priority ?? 60,
          score: prospect.score == null ? undefined : new Prisma.Decimal(prospect.score),
          metadataJson: toPrismaJson({
            source: 'seed_prospect',
            origin: prospect.origin ?? 'client_metadata',
          }),
        },
      });
      createdLeadIds.push(lead.id);
    }

    if (createdLeadIds.length) {
      return createdLeadIds;
    }

    const aiBootstrap = await this.aiService.bootstrapCampaignActivation({
      clientId: input.clientId,
      campaignId: input.campaignId,
      workflowRunId: input.workflowRunId,
      workflowTitle: 'Automatic client launch',
    });

    return aiBootstrap.sendableLeadIds ?? [];
  }

  private asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {};
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }

  private readSeedProspects(value: unknown): Array<any> {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.asObject(item))
      .map((item) => {
        const email = this.readString(item.email)?.toLowerCase();
        const fullName =
          this.readString(item.fullName) ?? [this.readString(item.firstName), this.readString(item.lastName)].filter(Boolean).join(' ');
        if (!email || !fullName) return null;
        return {
          companyName: this.readString(item.companyName) ?? undefined,
          domain: this.readString(item.domain) ?? undefined,
          industry: this.readString(item.industry) ?? undefined,
          fullName,
          firstName: this.readString(item.firstName) ?? undefined,
          lastName: this.readString(item.lastName) ?? undefined,
          title: this.readString(item.title) ?? undefined,
          email,
          phone: this.readString(item.phone) ?? undefined,
          websiteUrl: this.readString(item.websiteUrl) ?? undefined,
          linkedinUrl: this.readString(item.linkedinUrl) ?? undefined,
          city: this.readString(item.city) ?? undefined,
          region: this.readString(item.region) ?? undefined,
          countryCode: this.readString(item.countryCode) ?? undefined,
          timezone: this.readString(item.timezone) ?? undefined,
          priority: typeof item.priority === 'number' ? item.priority : undefined,
          score: typeof item.score === 'number' ? item.score : undefined,
          origin: this.readString(item.origin) ?? undefined,
        };
      })
      .filter(Boolean) as Array<any>;
  }
}
