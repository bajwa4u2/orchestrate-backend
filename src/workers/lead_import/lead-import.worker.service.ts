
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ContactEmailStatus,
  Job,
  JobStatus,
  JobType,
  LeadQualificationState,
  LeadSourceType,
  LeadStatus,
  QualificationStatus,
  Prisma,
  RecordSource,
} from '@prisma/client';
import { AiService } from '../../ai/ai.service';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { LeadSourcesService } from '../../lead-sources/lead-sources.service';
import { ExternalLeadCandidate, LeadTargetingContext } from '../../lead-sources/lead-sources.types';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class LeadImportWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.LEAD_IMPORT];

  private readonly logger = new Logger(LeadImportWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly leadSourcesService: LeadSourcesService,
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

    const campaignMetadata = this.asObject(campaign.metadataJson);
    const activation = this.asObject(campaignMetadata.activation);
    const activationBootstrapStatus = this.readString(activation.bootstrapStatus);
    const terminalBootstrapStates = new Set([
      'launch_queued',
      'leads_ready_non_sendable',
      'blocked_no_sendable_leads',
      'activation_completed',
    ]);

    if (!terminalBootstrapStates.has(activationBootstrapStatus ?? '')) {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'READY',
          generationState: 'TARGETING_READY',
          metadataJson: toPrismaJson({
            ...campaignMetadata,
            activation: {
              ...activation,
              bootstrapStatus: 'activation_in_progress',
              jobId: job.id,
              lastJobId: job.id,
              lastBootstrapAt: new Date().toISOString(),
              retryAt: null,
              failedAt: null,
            },
          }),
        },
      });
    }

    const existingVisibleLeads = await this.prisma.lead.findMany({
      where: {
        campaignId: campaign.id,
        status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] },
      },
      select: { id: true },
      take: 25,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    let createdLeadIds: string[] = [];
    let bootstrapSkippedReason: string | null = null;

    if (existingVisibleLeads.length) {
      bootstrapSkippedReason = 'visible_leads_already_exist';
      this.logger.log(
        `Lead import bootstrap skipped for campaign ${campaign.id} because ${existingVisibleLeads.length} visible leads already exist.`,
      );
    } else if (terminalBootstrapStates.has(activationBootstrapStatus ?? '')) {
      bootstrapSkippedReason = activationBootstrapStatus ?? 'terminal_bootstrap_state';
      this.logger.log(
        `Lead import bootstrap skipped for campaign ${campaign.id} because activation is already in terminal state: ${bootstrapSkippedReason}.`,
      );
    } else {
      createdLeadIds = await this.bootstrapLeadsFromClientAssets({
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        workflowRunId: context.workflowRunId,
        campaignMetadataJson: campaign.metadataJson,
        clientMetadataJson: campaign.client.metadataJson,
        clientScopeJson: campaign.client.scopeJson,
        clientIndustry: campaign.client.industry,
      });
    }

    const visibleLeads = await this.prisma.lead.findMany({
      where: {
        campaignId: campaign.id,
        status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] },
      },
      select: { id: true },
      take: 25,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    const sendableLeads = await this.prisma.lead.findMany({
      where: {
        campaignId: campaign.id,
        status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] },
        contact: { email: { not: null } },
      },
      select: { id: true },
      take: 25,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    const candidateLeadIds = sendableLeads.map((item) => item.id).slice(0, 25);

    const queuedMessageGenerationJobIds: string[] = [];
    for (const leadId of candidateLeadIds) {
      const dedupeKey = `first_send:${leadId}`;
      const existing = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: {
            in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED],
          },
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

    const visibleLeadCount = visibleLeads.length;
    const sendableLeadCount = candidateLeadIds.length;
    const completedBootstrapStatus = sendableLeadCount
      ? 'launch_queued'
      : visibleLeadCount
        ? 'leads_ready_non_sendable'
        : 'blocked_no_sendable_leads';

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: visibleLeadCount ? 'ACTIVE' : 'READY',
        generationState: visibleLeadCount
          ? sendableLeadCount
            ? 'ACTIVE'
            : 'LEADS_READY'
          : 'TARGETING_READY',
        metadataJson: toPrismaJson({
          ...campaignMetadata,
          activation: {
            ...activation,
            lastBootstrapAt: new Date().toISOString(),
            bootstrapStatus: completedBootstrapStatus,
            jobId: job.id,
            lastJobId: job.id,
            createdLeadCount: createdLeadIds.length,
            visibleLeadCount,
            sendableLeadCount,
            queuedFirstSendCount: queuedMessageGenerationJobIds.length,
            blockedReason: sendableLeadCount
              ? null
              : visibleLeadCount
                ? 'Leads were discovered, but no contact email was available yet.'
                : 'No visible leads were available from contacts, seed prospects, Apollo search, or AI bootstrap.',
            bootstrapSkippedReason,
          },
        }),
      },
    });

    return {
      ok: true,
      campaignId: campaign.id,
      createdLeadCount: createdLeadIds.length,
      visibleLeadCount,
      sendableLeadCount,
      queuedFirstSendCount: queuedMessageGenerationJobIds.length,
      queuedJobIds: queuedMessageGenerationJobIds,
      waitingForLeadSource: visibleLeadCount === 0,
    };
  }

  private async bootstrapLeadsFromClientAssets(input: {
    organizationId: string;
    clientId: string;
    campaignId: string;
    workflowRunId?: string;
    campaignMetadataJson?: Prisma.JsonValue | null;
    clientMetadataJson?: Prisma.JsonValue | null;
    clientScopeJson?: Prisma.JsonValue | null;
    clientIndustry?: string | null;
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
    const seedProspects = this.readSeedProspects(
      setup.seedProspects ?? metadata.seedProspects ?? scope.seedProspects,
    );

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

    const apolloLeadIds = await this.importApolloProspects({
      organizationId: input.organizationId,
      clientId: input.clientId,
      campaignId: input.campaignId,
      workflowRunId: input.workflowRunId,
      campaignMetadataJson: input.campaignMetadataJson ?? null,
      clientMetadataJson: input.clientMetadataJson ?? client?.metadataJson ?? null,
      clientScopeJson: input.clientScopeJson ?? client?.scopeJson ?? null,
      clientIndustry: input.clientIndustry ?? client?.industry ?? null,
    });

    if (apolloLeadIds.length) {
      return apolloLeadIds;
    }

    try {
      const aiBootstrap = await this.aiService.bootstrapCampaignActivation({
        clientId: input.clientId,
        campaignId: input.campaignId,
        workflowRunId: input.workflowRunId,
        workflowTitle: 'Automatic client launch',
      });
      return (aiBootstrap.leadIds && aiBootstrap.leadIds.length > 0)
        ? aiBootstrap.leadIds
        : (aiBootstrap.sendableLeadIds ?? []);
    } catch (error) {
      this.logger.warn(
        `AI bootstrap failed for campaign ${input.campaignId}; continuing without AI-generated leads: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async importApolloProspects(input: {
    organizationId: string;
    clientId: string;
    campaignId: string;
    workflowRunId?: string;
    campaignMetadataJson?: Prisma.JsonValue | null;
    clientMetadataJson?: Prisma.JsonValue | null;
    clientScopeJson?: Prisma.JsonValue | null;
    clientIndustry?: string | null;
  }) {
    const targeting = this.buildApolloTargeting({
      campaignMetadataJson: input.campaignMetadataJson ?? null,
      clientMetadataJson: input.clientMetadataJson ?? null,
      clientScopeJson: input.clientScopeJson ?? null,
      clientIndustry: input.clientIndustry ?? null,
    });

    const searchResult = await this.leadSourcesService.searchApollo({
      organizationId: input.organizationId,
      clientId: input.clientId,
      campaignId: input.campaignId,
      workflowRunId: input.workflowRunId,
      targeting,
    });

    const totalProspects = searchResult.prospects.length;
    if (!totalProspects) {
      this.logger.log(`Apollo returned no candidates for campaign ${input.campaignId}.`);
      return [];
    }

    const sendableProspects = searchResult.prospects.filter((prospect) => Boolean(this.readString(prospect.email)));
    const skippedMissingEmailCount = totalProspects - sendableProspects.length;

    const leadSource = await this.prisma.leadSource.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        workflowRunId: input.workflowRunId,
        name: 'Apollo lead sourcing',
        type: LeadSourceType.API,
        source: RecordSource.EXTERNAL_SYNC,
        sourceRef: searchResult.providerRef,
        importedAt: new Date(),
        configJson: toPrismaJson({
          provider: searchResult.provider,
          querySummary: searchResult.querySummary,
          totalProspects,
          sendableProspects: sendableProspects.length,
          skippedMissingEmailCount,
        }),
      },
      select: { id: true },
    });

    if (!sendableProspects.length) {
      this.logger.warn(
        `Apollo found ${totalProspects} candidates for campaign ${input.campaignId}, but none had usable email addresses after enrichment.`,
      );
      return [];
    }

    const createdLeadIds: string[] = [];

    for (const prospect of sendableProspects) {
      const leadId = await this.upsertApolloProspect({
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        workflowRunId: input.workflowRunId,
        leadSourceId: leadSource.id,
        prospect,
      });

      if (leadId) {
        createdLeadIds.push(leadId);
      }
    }

    this.logger.log(
      `Apollo import for campaign ${input.campaignId}: ${totalProspects} candidates, ${sendableProspects.length} sendable, ${createdLeadIds.length} leads created, ${skippedMissingEmailCount} skipped without email.`,
    );

    return createdLeadIds;
  }

  private async upsertApolloProspect(input: {
    organizationId: string;
    clientId: string;
    campaignId: string;
    workflowRunId?: string;
    leadSourceId: string;
    prospect: ExternalLeadCandidate;
  }) {
    const email = this.readString(input.prospect.email)?.toLowerCase() ?? null;

    let accountId: string | null = null;
    const normalizedDomain = this.normalizeDomain(input.prospect.domain);
    const companyName = this.readString(input.prospect.companyName);
    const fullName =
      this.readString(input.prospect.contactFullName) ||
      [this.readString(input.prospect.firstName), this.readString(input.prospect.lastName)]
        .filter(Boolean)
        .join(' ') ||
      'Apollo Contact';

    if (normalizedDomain || companyName) {
      const existingAccount = await this.prisma.account.findFirst({
        where: {
          clientId: input.clientId,
          OR: [
            ...(normalizedDomain ? [{ domain: normalizedDomain }] : []),
            ...(companyName ? [{ companyName }] : []),
          ],
        },
        select: { id: true },
      });
      accountId = existingAccount?.id ?? null;
    }

    if (!accountId && companyName) {
      const account = await this.prisma.account.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          domain: normalizedDomain ?? undefined,
          companyName,
          industry: this.readString(input.prospect.industry) ?? undefined,
          employeeCount: input.prospect.employeeCount ?? undefined,
          city: this.readString(input.prospect.city) ?? undefined,
          region: this.readString(input.prospect.region) ?? undefined,
          countryCode: this.readString(input.prospect.countryCode) ?? undefined,
          websiteUrl: normalizedDomain ? `https://${normalizedDomain}` : undefined,
          linkedinUrl: undefined,
          enrichmentJson: toPrismaJson({
            provider: input.prospect.provider,
            providerOrganizationId: input.prospect.providerOrganizationId,
            sourcePayload: input.prospect.sourcePayload ?? null,
          }),
        },
        select: { id: true },
      });
      accountId = account.id;
    }

    const contactWhere: Array<Record<string, unknown>> = [];
    if (email) {
      contactWhere.push({ email });
    }
    if (fullName) {
      contactWhere.push({
        fullName,
        ...(accountId ? { accountId } : {}),
      });
    }

    let contactId: string | null = null;
    if (contactWhere.length) {
      const existingContact = await this.prisma.contact.findFirst({
        where: {
          clientId: input.clientId,
          OR: contactWhere as Prisma.ContactWhereInput[],
        },
        select: { id: true },
      });
      contactId = existingContact?.id ?? null;
    }

    if (!contactId && (fullName || email)) {
      const contact = await this.prisma.contact.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          accountId: accountId ?? undefined,
          firstName: this.readString(input.prospect.firstName) ?? undefined,
          lastName: this.readString(input.prospect.lastName) ?? undefined,
          fullName: fullName,
          title: this.readString(input.prospect.title) ?? undefined,
          email: email ?? undefined,
          emailStatus: this.mapEmailStatus(input.prospect.emailStatus),
          linkedinUrl: this.readString(input.prospect.linkedinUrl) ?? undefined,
          timezone: this.readString(input.prospect.timezone) ?? undefined,
          city: this.readString(input.prospect.city) ?? undefined,
          region: this.readString(input.prospect.region) ?? undefined,
          countryCode: this.readString(input.prospect.countryCode) ?? undefined,
          qualificationStatus: QualificationStatus.UNREVIEWED,
          enrichmentJson: toPrismaJson({
            provider: input.prospect.provider,
            providerPersonId: input.prospect.providerPersonId,
            providerOrganizationId: input.prospect.providerOrganizationId,
            qualificationNotes: input.prospect.qualificationNotes ?? null,
            sourcePayload: input.prospect.sourcePayload ?? null,
          }),
        },
        select: { id: true },
      });
      contactId = contact.id;
    }

    const existingLead = await this.prisma.lead.findFirst({
      where: {
        campaignId: input.campaignId,
        contactId: contactId ?? undefined,
      },
      select: { id: true },
    });

    if (existingLead) {
      return existingLead.id;
    }

    const lead = await this.prisma.lead.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        leadSourceId: input.leadSourceId,
        accountId: accountId ?? undefined,
        contactId: contactId ?? undefined,
        workflowRunId: input.workflowRunId,
        status: LeadStatus.NEW,
        source: RecordSource.EXTERNAL_SYNC,
        qualificationState: LeadQualificationState.DISCOVERED,
        priority: input.prospect.priority ?? 70,
        metadataJson: toPrismaJson({
          source: 'apollo',
          provider: input.prospect.provider,
          providerPersonId: input.prospect.providerPersonId,
          providerOrganizationId: input.prospect.providerOrganizationId,
          reasonForFit: input.prospect.reasonForFit,
          qualificationNotes: input.prospect.qualificationNotes ?? null,
          hasEmail: Boolean(email),
        }),
      },
      select: { id: true },
    });

    return lead.id;
  }

  private buildApolloTargeting(input: {
    campaignMetadataJson?: Prisma.JsonValue | null;
    clientMetadataJson?: Prisma.JsonValue | null;
    clientScopeJson?: Prisma.JsonValue | null;
    clientIndustry?: string | null;
  }): LeadTargetingContext {
    const campaignMetadata = this.asObject(input.campaignMetadataJson);
    const strategy = this.asObject(campaignMetadata.strategy);
    const serviceProfile = this.asObject(campaignMetadata.serviceProfile);
    const clientScope = this.asObject(input.clientScopeJson);
    const clientMetadata = this.asObject(input.clientMetadataJson);
    const setup = this.asObject(clientMetadata.setup);

    const industries = this.uniqueNonEmpty([
      ...this.readStringArray(strategy.industryTags),
      ...this.readScopeLabels(clientScope.industries),
      this.readString(serviceProfile.industry),
      this.readString(setup.industry),
      this.readString(input.clientIndustry),
    ]);

    const geoTargets = this.uniqueNonEmpty([
      ...this.readStringArray(strategy.geoTargets),
      ...this.readScopeLabels(clientScope.countries),
      ...this.readScopeLabels(clientScope.regions),
      ...this.readStringArray(serviceProfile.countries),
      ...this.readStringArray(serviceProfile.regions),
    ]);

    const titleKeywords = this.uniqueNonEmpty([
      ...this.readStringArray(strategy.titleKeywords),
      ...this.readStringArray(serviceProfile.buyerRoles),
      ...this.readStringArray(setup.roles),
    ]);

    const exclusionKeywords = this.uniqueNonEmpty([
      ...this.readStringArray(strategy.exclusionKeywords),
      ...this.readStringArray(setup.excludeKeywords),
    ]);

    const employeeRanges = this.readEmployeeRanges(
      clientScope.companySizes ?? setup.companySizes ?? serviceProfile.companySizes,
    );
    const seniorities = this.deriveSeniorities(titleKeywords);

    return {
      campaignName: this.readString(strategy.campaignName) ?? this.readString(campaignMetadata.name) ?? undefined,
      objective: this.readString(strategy.objective) ?? this.readString(campaignMetadata.objective) ?? undefined,
      offerSummary: this.readString(strategy.offerSummary) ?? this.readString(serviceProfile.offerSummary) ?? undefined,
      industry: industries[0],
      industries,
      geoTargets,
      titleKeywords: titleKeywords.length ? titleKeywords : ['Founder', 'Owner', 'Director'],
      exclusionKeywords,
      employeeRanges: employeeRanges.length ? employeeRanges : ['1,10', '11,50', '51,200'],
      seniorities: seniorities.length ? seniorities : ['owner', 'founder', 'director', 'head'],
      maxResults: 10,
    };
  }

  private mapEmailStatus(value?: string) {
    const normalized = (value ?? '').trim().toLowerCase();
    switch (normalized) {
      case 'verified':
      case 'likely to engage':
        return ContactEmailStatus.VERIFIED;
      case 'risky':
        return ContactEmailStatus.RISKY;
      case 'bounced':
        return ContactEmailStatus.BOUNCED;
      case 'invalid':
      case 'unavailable':
        return ContactEmailStatus.INVALID;
      default:
        return ContactEmailStatus.UNVERIFIED;
    }
  }

  private normalizeDomain(value?: string | null) {
    const domain = this.readString(value);
    if (!domain) return null;
    return domain
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/$/, '')
      .toLowerCase();
  }

  private deriveSeniorities(titles: string[]) {
    const detected = new Set<string>();
    for (const title of titles) {
      const lowered = title.toLowerCase();
      if (lowered.includes('owner')) detected.add('owner');
      if (lowered.includes('founder')) detected.add('founder');
      if (
        lowered.includes('chief') ||
        lowered.includes('ceo') ||
        lowered.includes('cto') ||
        lowered.includes('cmo')
      )
        detected.add('c_suite');
      if (lowered.includes('vp')) detected.add('vp');
      if (lowered.includes('head')) detected.add('head');
      if (lowered.includes('director')) detected.add('director');
      if (lowered.includes('manager')) detected.add('manager');
    }
    return Array.from(detected);
  }

  private readEmployeeRanges(value: unknown) {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const mapped = values
      .map((item) =>
        this.readString(
          typeof item === 'string' ? item : this.asObject(item).label ?? this.asObject(item).code,
        ),
      )
      .filter(Boolean)
      .map((item) => this.mapEmployeeRange(item as string))
      .filter(Boolean) as string[];
    return this.uniqueNonEmpty(mapped);
  }

  private mapEmployeeRange(value: string) {
    const normalized = value.toLowerCase();
    if (normalized.includes('1') && normalized.includes('10')) return '1,10';
    if (normalized.includes('11') && normalized.includes('50')) return '11,50';
    if (normalized.includes('51') && normalized.includes('200')) return '51,200';
    if (normalized.includes('201') && normalized.includes('500')) return '201,500';
    if (normalized.includes('500') && normalized.includes('1000')) return '500,1000';
    return null;
  }

  private asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, any>) }
      : {};
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.readString(item))
      .filter((item): item is string => Boolean(item));
  }

  private readScopeLabels(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.asObject(item))
      .map(
        (item) =>
          this.readString(item.label) ??
          this.readString(item.code) ??
          this.readString(item.regionLabel) ??
          this.readString(item.regionCode),
      )
      .filter((item): item is string => Boolean(item));
  }

  private uniqueNonEmpty(values: Array<string | undefined | null>) {
    return Array.from(
      new Set(values.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
    );
  }

  private readSeedProspects(value: unknown): Array<any> {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.asObject(item))
      .map((item) => {
        const email = this.readString(item.email)?.toLowerCase();
        const fullName =
          this.readString(item.fullName) ??
          [this.readString(item.firstName), this.readString(item.lastName)].filter(Boolean).join(' ');
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
