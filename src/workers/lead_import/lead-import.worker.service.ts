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
  RecordSource,
} from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { AdaptationService } from '../../adaptation/adaptation.service';
import { LeadSourcesService } from '../../lead-sources/lead-sources.service';
import { ProviderFallbackService } from '../../providers/provider-fallback.service';
import { QualificationService } from '../../qualification/qualification.service';
import { ReachabilityBuilderService } from '../../reachability/reachability-builder.service';
import { SignalDetectionService } from '../../signals/signal-detection.service';
import { SourcePlannerService } from '../../sources/source-planner.service';
import { StrategyService } from '../../strategy/strategy.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class LeadImportWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.LEAD_IMPORT];
  private readonly logger = new Logger(LeadImportWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyService: StrategyService,
    private readonly signalDetectionService: SignalDetectionService,
    private readonly sourcePlannerService: SourcePlannerService,
    private readonly reachabilityBuilderService: ReachabilityBuilderService,
    private readonly qualificationService: QualificationService,
    private readonly adaptationService: AdaptationService,
    private readonly leadSourcesService: LeadSourcesService,
    private readonly providerFallbackService: ProviderFallbackService,
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

    const refillMode = this.readString(context.payload.refillMode) === 'continuity_refill';
    const targetSendableFloor = this.readPositiveInt(context.payload.targetSendableFloor) ?? 10;
    const maxLeadCount = Math.max(1, Math.min(this.readPositiveInt(context.payload.maxLeadCount) ?? 25, 50));
    const campaignMetadata = this.asObject(campaign.metadataJson);
    const activation = this.asObject(campaignMetadata.activation);
    const continuity = this.asObject(campaignMetadata.continuity);

    await this.markCampaignInProgress(campaign.id, campaignMetadata, activation, continuity, refillMode, job.id, targetSendableFloor, maxLeadCount);

    const strategyResult = await this.strategyService.generateForCampaign({
      campaignId: campaign.id,
      organizationId: campaign.organizationId,
    });
    const signals = await this.signalDetectionService.detectForCampaign({
      campaignId: campaign.id,
      organizationId: campaign.organizationId,
    });
    const discovery = await this.sourcePlannerService.discoverForCampaign({
      campaignId: campaign.id,
      organizationId: campaign.organizationId,
    });

    let externalProspectsImported = 0;
    let discoveredEntities = discovery.entities;
    if (!discoveredEntities.length) {
      const fallbackDecision = await this.providerFallbackService.canUseApollo({
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        reason: 'internal_paths_insufficient',
        budgetUnitsRequested: maxLeadCount,
        internalResultCount: 0,
      });

      if (fallbackDecision.allowed) {
        const apollo = await this.leadSourcesService.searchApollo({
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          campaignId: campaign.id,
          workflowRunId: context.workflowRunId,
          targeting: {
            campaignName: campaign.name,
            objective: campaign.objective ?? undefined,
            offerSummary: campaign.offerSummary ?? undefined,
            industry: campaign.client.industry ?? undefined,
            industries: campaign.client.industry ? [campaign.client.industry] : [],
            geoTargets: this.extractGeoTargets(campaign.client.scopeJson, campaign.metadataJson),
            titleKeywords: ['owner', 'founder', 'director', 'manager'],
            exclusionKeywords: [],
            employeeRanges: [],
            seniorities: ['owner', 'director'],
            maxResults: maxLeadCount,
          },
        });

        externalProspectsImported = apollo.importedCount;
        for (const prospect of apollo.prospects) {
          const dedupeKey = `${prospect.companyName.toLowerCase()}|${(prospect.contactFullName || '').toLowerCase()}|${(prospect.domain || '').toLowerCase()}`;
          const entity = await this.prisma.discoveredEntity.upsert({
            where: { campaignId_dedupeKey: { campaignId: campaign.id, dedupeKey } },
            update: {
              companyName: prospect.companyName,
              personName: prospect.contactFullName,
              inferredRole: prospect.title ?? null,
              domain: prospect.domain ?? null,
              geography: [prospect.city, prospect.region, prospect.countryCode].filter(Boolean).join(', ') || null,
              sourceEvidenceJson: toPrismaJson({ provider: prospect.provider, sourcePayload: prospect.sourcePayload }),
              entityConfidence: prospect.priority ?? 75,
              status: 'DISCOVERED',
            },
            create: {
              organizationId: campaign.organizationId,
              clientId: campaign.clientId,
              campaignId: campaign.id,
              opportunityProfileId: strategyResult.opportunityProfile.id,
              companyName: prospect.companyName,
              personName: prospect.contactFullName,
              inferredRole: prospect.title ?? null,
              websiteUrl: prospect.domain ? `https://${prospect.domain}` : null,
              domain: prospect.domain ?? null,
              geography: [prospect.city, prospect.region, prospect.countryCode].filter(Boolean).join(', ') || null,
              sourceEvidenceJson: toPrismaJson({ provider: prospect.provider, sourcePayload: prospect.sourcePayload }),
              entityConfidence: prospect.priority ?? 75,
              dedupeKey,
              status: 'DISCOVERED',
            },
          });
          discoveredEntities.push(entity);
        }
      }
    }

    const acceptedLeadIds: string[] = [];
    for (const entity of discoveredEntities.slice(0, maxLeadCount)) {
      const reachability = await this.reachabilityBuilderService.buildForEntity({ entityId: entity.id, organizationId: campaign.organizationId });
      const evaluation = await this.qualificationService.evaluateEntity({ entityId: entity.id, organizationId: campaign.organizationId });
      if (evaluation.qualification.decision !== 'ACCEPT') {
        continue;
      }

      if (reachability.policy === 'BLOCKED') {
        continue;
      }

      const email = reachability.record.emailCandidate;
      if (!email) {
        continue;
      }

      const account = await this.prisma.account.upsert({
        where: { id: entity.id },
        update: {
          companyName: entity.companyName,
          domain: entity.domain ?? reachability.record.domain ?? null,
          city: this.firstToken(entity.geography),
          websiteUrl: entity.websiteUrl ?? null,
          qualificationStatus: QualificationStatus.ACCEPTED,
          score: evaluation.qualification.finalScore,
          enrichmentJson: toPrismaJson({ entityId: entity.id, opportunityProfileId: entity.opportunityProfileId }),
        },
        create: {
          id: entity.id,
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          companyName: entity.companyName,
          domain: entity.domain ?? reachability.record.domain ?? null,
          city: this.firstToken(entity.geography),
          websiteUrl: entity.websiteUrl ?? null,
          qualificationStatus: QualificationStatus.ACCEPTED,
          score: evaluation.qualification.finalScore,
          enrichmentJson: toPrismaJson({ entityId: entity.id, opportunityProfileId: entity.opportunityProfileId }),
        },
      });

      const contact = await this.prisma.contact.upsert({
        where: { id: entity.id },
        update: {
          accountId: account.id,
          fullName: entity.personName ?? entity.companyName,
          title: entity.inferredRole ?? null,
          email,
          emailStatus: ContactEmailStatus.UNVERIFIED,
          city: this.firstToken(entity.geography),
          qualificationStatus: QualificationStatus.ACCEPTED,
          score: evaluation.qualification.finalScore,
          enrichmentJson: toPrismaJson({ reachabilityRecordId: reachability.record.id }),
        },
        create: {
          id: entity.id,
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          accountId: account.id,
          fullName: entity.personName ?? entity.companyName,
          title: entity.inferredRole ?? null,
          email,
          emailStatus: ContactEmailStatus.UNVERIFIED,
          city: this.firstToken(entity.geography),
          qualificationStatus: QualificationStatus.ACCEPTED,
          score: evaluation.qualification.finalScore,
          enrichmentJson: toPrismaJson({ reachabilityRecordId: reachability.record.id }),
        },
      });

      const lead = await this.prisma.lead.upsert({
        where: { campaignId_contactId: { campaignId: campaign.id, contactId: contact.id } },
        update: {
          accountId: account.id,
          contactId: contact.id,
          workflowRunId: context.workflowRunId ?? null,
          status: LeadStatus.QUALIFIED,
          source: RecordSource.SYSTEM_GENERATED,
          qualificationState: LeadQualificationState.QUALIFIED,
          score: evaluation.qualification.finalScore,
          priority: Math.round(Number(evaluation.qualification.finalScore ?? 70)),
          metadataJson: toPrismaJson({
            opportunityProfileId: strategyResult.opportunityProfile.id,
            discoveredEntityId: entity.id,
            reachabilityRecordId: reachability.record.id,
            qualificationDecisionId: evaluation.qualification.id,
            signalCount: signals.items.length,
          }),
        },
        create: {
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          campaignId: campaign.id,
          accountId: account.id,
          contactId: contact.id,
          workflowRunId: context.workflowRunId ?? null,
          status: LeadStatus.QUALIFIED,
          source: RecordSource.SYSTEM_GENERATED,
          qualificationState: LeadQualificationState.QUALIFIED,
          score: evaluation.qualification.finalScore,
          priority: Math.round(Number(evaluation.qualification.finalScore ?? 70)),
          metadataJson: toPrismaJson({
            opportunityProfileId: strategyResult.opportunityProfile.id,
            discoveredEntityId: entity.id,
            reachabilityRecordId: reachability.record.id,
            qualificationDecisionId: evaluation.qualification.id,
            signalCount: signals.items.length,
          }),
        },
      });

      acceptedLeadIds.push(lead.id);
    }

    const queuedJobIds: string[] = [];
    for (const leadId of acceptedLeadIds.slice(0, maxLeadCount)) {
      const dedupeKey = `first_send:${leadId}`;
      const existing = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED] },
        },
        select: { id: true },
      });
      if (existing) continue;

      const sendJob = await this.prisma.job.create({
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
            note: 'automatic launch from opportunity discovery pipeline',
          }),
        },
      });
      queuedJobIds.push(sendJob.id);
    }

    await this.adaptationService.runForCampaign({ campaignId: campaign.id, organizationId: campaign.organizationId });

    const visibleLeadCount = await this.prisma.lead.count({
      where: { campaignId: campaign.id, status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] } },
    });
    const sendableLeadCount = await this.prisma.lead.count({
      where: { campaignId: campaign.id, status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] }, contact: { is: { email: { not: null } } } },
    });

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: visibleLeadCount ? 'ACTIVE' : 'READY',
        generationState: visibleLeadCount ? (sendableLeadCount ? 'ACTIVE' : 'LEADS_READY') : 'TARGETING_READY',
        metadataJson: toPrismaJson({
          ...campaignMetadata,
          activation: {
            ...activation,
            jobId: job.id,
            currentJobId: job.id,
            bootstrapStatus: sendableLeadCount ? 'activation_completed' : 'blocked_no_sendable_leads',
            completedAt: sendableLeadCount ? new Date().toISOString() : null,
            lastError: null,
            pipeline: {
              opportunityProfileId: strategyResult.opportunityProfile.id,
              sourcePlanId: strategyResult.sourcePlan.id,
              signalCount: signals.items.length,
              internalEntityCount: discovery.entities.length,
              providerImportedCount: externalProspectsImported,
            },
          },
          continuity: {
            ...continuity,
            status: sendableLeadCount >= targetSendableFloor ? 'inventory_ready' : 'inventory_low',
            targetSendableFloor,
            activeLeadImportJobId: null,
          },
        }),
      },
    });

    return {
      ok: true,
      campaignId: campaign.id,
      opportunityProfileId: strategyResult.opportunityProfile.id,
      signalCount: signals.items.length,
      discoveredEntityCount: discovery.entities.length,
      importedFallbackProspectCount: externalProspectsImported,
      createdLeadCount: acceptedLeadIds.length,
      visibleLeadCount,
      sendableLeadCount,
      queuedFirstSendCount: queuedJobIds.length,
      queuedJobIds,
      waitingForLeadSource: !sendableLeadCount,
    };
  }

  private async markCampaignInProgress(
    campaignId: string,
    metadata: Record<string, unknown>,
    activation: Record<string, unknown>,
    continuity: Record<string, unknown>,
    refillMode: boolean,
    jobId: string,
    targetSendableFloor: number,
    maxLeadCount: number,
  ) {
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        metadataJson: toPrismaJson({
          ...metadata,
          ...(refillMode
            ? {
                continuity: {
                  ...continuity,
                  status: 'refill_in_progress',
                  jobId,
                  currentJobId: jobId,
                  targetSendableFloor,
                  maxLeadCount,
                  startedAt: new Date().toISOString(),
                  lastError: null,
                },
              }
            : {
                activation: {
                  ...activation,
                  jobId,
                  currentJobId: jobId,
                  bootstrapStatus: 'activation_in_progress',
                  startedAt: new Date().toISOString(),
                  lastError: null,
                },
              }),
        }),
      },
    });
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : null;
  }

  private readPositiveInt(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }

  private extractGeoTargets(scopeJson: unknown, metadataJson: unknown) {
    const scope = this.asObject(scopeJson);
    const metadata = this.asObject(metadataJson);
    const geography = this.asObject(scope.geography);
    const targets = [
      ...this.readStringArray(geography.countries),
      ...this.readStringArray(geography.regions),
      ...this.readStringArray(geography.cities),
      ...this.readStringArray(this.asObject(metadata.targeting).regions),
    ];
    return Array.from(new Set(targets)).slice(0, 8);
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) return [] as string[];
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  }

  private firstToken(value?: string | null) {
    return typeof value === 'string' ? value.split(',')[0].trim() || null : null;
  }
}
