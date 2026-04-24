import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CommunicationType,
  ContactConsentStatus,
  ContactEmailStatus,
  Job,
  JobStatus,
  JobType,
  LeadQualificationState,
  LeadStatus,
  QualificationStatus,
  RecordSource,
  Prisma,
} from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { policyService } from '../../common/policy/data-policy';
import { PrismaService } from '../../database/prisma.service';
import { AdaptationService } from '../../adaptation/adaptation.service';
import { LeadSourcesService } from '../../lead-sources/lead-sources.service';
import { ProviderFallbackService } from '../../providers/provider-fallback.service';
import { QualificationService } from '../../qualification/qualification.service';
import { ReachabilityBuilderService } from '../../reachability/reachability-builder.service';
import { SignalDetectionService } from '../../signals/signal-detection.service';
import { SourcePlannerService } from '../../sources/source-planner.service';
import { StrategyService } from '../../strategy/strategy.service';
import { DeliverabilityService } from '../../deliverability/deliverability.service';
import { AiDecisionEnforcementService } from '../../ai/governance/ai-decision-enforcement.service';
import { AiDecisionGatewayService } from '../../ai/governance/ai-decision-gateway.service';
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
    private readonly deliverabilityService: DeliverabilityService,
    private readonly decisionGateway: AiDecisionGatewayService,
    private readonly decisionEnforcement: AiDecisionEnforcementService,
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

    await this.markCampaignInProgress(
      campaign.id,
      campaignMetadata,
      activation,
      continuity,
      refillMode,
      job.id,
      targetSendableFloor,
      maxLeadCount,
    );

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
    const discoveredEntities = [...discovery.entities];

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
          const entityPolicy = policyService.evaluateEntity({
            companyName: prospect.companyName,
            personName: prospect.contactFullName,
            domain: prospect.domain,
            websiteUrl: prospect.domain ? `https://${prospect.domain}` : null,
          });
          if (entityPolicy.status === 'BLOCKED') {
            continue;
          }

          const dedupeKey = `${prospect.companyName.toLowerCase()}|${(prospect.contactFullName || '').toLowerCase()}|${(prospect.domain || '').toLowerCase()}`;
          const entity = await this.prisma.discoveredEntity.upsert({
            where: { campaignId_dedupeKey: { campaignId: campaign.id, dedupeKey } },
            update: {
              companyName: prospect.companyName,
              personName: prospect.contactFullName,
              inferredRole: prospect.title ?? null,
              domain: prospect.domain ?? null,
              geography: [prospect.city, prospect.region, prospect.countryCode].filter(Boolean).join(', ') || null,
              sourceEvidenceJson: toPrismaJson({
                provider: prospect.provider,
                sourcePayload: prospect.sourcePayload,
                policy: {
                  sourceStatus: 'RESTRICTED',
                  sourceReason: 'provider_fallback_only',
                  entityStatus: entityPolicy.status,
                  entityReason: entityPolicy.reason,
                },
              }),
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
              sourceEvidenceJson: toPrismaJson({
                provider: prospect.provider,
                sourcePayload: prospect.sourcePayload,
                policy: {
                  sourceStatus: 'RESTRICTED',
                  sourceReason: 'provider_fallback_only',
                  entityStatus: entityPolicy.status,
                  entityReason: entityPolicy.reason,
                },
              }),
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
      const entityPolicy = policyService.evaluateEntity({
        companyName: entity.companyName,
        personName: entity.personName,
        domain: entity.domain,
        websiteUrl: entity.websiteUrl,
      });
      if (entityPolicy.status === 'BLOCKED') {
        continue;
      }

      const reachability = await this.reachabilityBuilderService.buildForEntity({
        entityId: entity.id,
        organizationId: campaign.organizationId,
      });
      const evaluation = await this.qualificationService.evaluateEntity({
        entityId: entity.id,
        organizationId: campaign.organizationId,
      });
      if (evaluation.qualification.decision !== 'ACCEPT') {
        continue;
      }

      const email = reachability.record.emailCandidate;
      const executionPolicy = policyService.evaluateExecution({
        email,
        companyName: entity.companyName,
        domain: reachability.record.domain ?? entity.domain,
      });
      if (!email || executionPolicy.status === 'BLOCKED') {
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
          enrichmentJson: toPrismaJson({
            entityId: entity.id,
            opportunityProfileId: entity.opportunityProfileId,
            executionPolicy,
          }),
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
          enrichmentJson: toPrismaJson({
            entityId: entity.id,
            opportunityProfileId: entity.opportunityProfileId,
            executionPolicy,
          }),
        },
      });

      const contact = await this.resolveOrCreateContact({
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        accountId: account.id,
        fullName: entity.personName ?? entity.companyName,
        title: entity.inferredRole ?? null,
        emailAddress: email,
        city: this.firstToken(entity.geography),
        qualificationStatus: QualificationStatus.ACCEPTED,
        score: evaluation.qualification.finalScore,
        enrichmentJson: {
          reachabilityRecordId: reachability.record.id,
          executionPolicy,
          discoveredEntityId: entity.id,
        },
      });

      const primaryEmailChannel = await this.deliverabilityService.ensurePrimaryEmailChannel({
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        contactId: contact.id,
        emailAddress: email,
        isVerified: contact.emailStatus === ContactEmailStatus.VERIFIED,
        verificationSource: 'reachability_builder',
        metadataJson: {
          discoveredEntityId: entity.id,
          reachabilityRecordId: reachability.record.id,
        },
      });

      await this.deliverabilityService.ensureCommunicationConsent({
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        contactId: contact.id,
        contactChannelId: primaryEmailChannel.id,
        communication: CommunicationType.OUTREACH,
        status: ContactConsentStatus.ALLOWED,
        source: RecordSource.SYSTEM_GENERATED,
        sourceLabel: 'lead_import_worker',
        reason: 'system-qualified outbound outreach contact',
        metadataJson: {
          discoveredEntityId: entity.id,
          reachabilityRecordId: reachability.record.id,
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
            primaryContactChannelId: primaryEmailChannel.id,
            executionPolicy,
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
            primaryContactChannelId: primaryEmailChannel.id,
            executionPolicy,
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
          status: {
            in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED],
          },
        },
        select: { id: true },
      });
      if (existing) continue;

      const governance = await this.decisionGateway.decide({
        scope: 'LEAD',
        entity: {
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          campaignId: campaign.id,
          leadId,
          workflowRunId: context.workflowRunId ?? null,
          jobId: job.id,
        },
        preferredAction: 'SEND_FIRST_OUTREACH',
        proposedJobType: JobType.FIRST_SEND,
        source: {
          layer: 'worker',
          service: LeadImportWorkerService.name,
          method: 'run',
          worker: LeadImportWorkerService.name,
          reason: 'queue_first_send_from_lead_import',
        },
        enforcement: {
          entityType: 'lead',
          entityId: leadId,
          operation: 'QUEUE',
          workflowRunId: context.workflowRunId ?? null,
          jobId: job.id,
        },
        metadata: {
          parentJobId: job.id,
          refillMode,
        },
      });

      const enforcement = await this.decisionEnforcement.enforce({
        decisionId: governance.decisionId,
        organizationId: campaign.organizationId,
        scope: 'LEAD',
        action: 'SEND_FIRST_OUTREACH',
        entity: governance.snapshot.entity,
        serviceName: LeadImportWorkerService.name,
        methodName: 'run',
        entityType: 'lead',
        entityId: leadId,
        operation: 'QUEUE',
        workflowRunId: context.workflowRunId ?? null,
        jobId: job.id,
        metadata: {
          queueName: 'outreach',
        },
      });

      if (!enforcement.allowed || !governance.decisionId) {
        this.logger.warn(
          `AI governance blocked first-send queue for lead ${leadId}: ${enforcement.reason}`,
        );
        continue;
      }

      const sendJob = await this.prisma.job.create({
        data: {
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          campaignId: campaign.id,
          aiDecisionId: governance.decisionId,
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
            aiDecisionId: governance.decisionId,
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
      where: {
        campaignId: campaign.id,
        status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] },
        contact: {
          is: {
            OR: [
              { contactChannels: { some: { type: 'EMAIL', status: 'ACTIVE' } } },
              { email: { not: null } },
            ],
          },
        },
      },
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


  private async resolveOrCreateContact(input: {
    organizationId: string;
    clientId: string;
    accountId?: string | null;
    fullName: string;
    title?: string | null;
    emailAddress: string;
    city?: string | null;
    qualificationStatus: QualificationStatus;
    score?: Prisma.Decimal | number | null;
    enrichmentJson?: Record<string, unknown>;
  }) {
    const normalizedEmail = input.emailAddress.trim().toLowerCase();
    const existing = await this.prisma.contact.findFirst({
      where: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        OR: [
          { email: normalizedEmail },
          {
            contactChannels: {
              some: {
                type: 'EMAIL',
                normalizedValue: normalizedEmail,
              },
            },
          },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const decimalScore =
      typeof input.score === 'number'
        ? new Prisma.Decimal(input.score)
        : input.score instanceof Prisma.Decimal
          ? input.score
          : input.score == null
            ? undefined
            : new Prisma.Decimal(input.score as any);

    if (existing) {
      return this.prisma.contact.update({
        where: { id: existing.id },
        data: {
          accountId: input.accountId ?? existing.accountId ?? undefined,
          fullName: existing.fullName || input.fullName,
          title: input.title ?? existing.title ?? undefined,
          email: existing.email ?? normalizedEmail,
          emailStatus: existing.emailStatus ?? ContactEmailStatus.UNVERIFIED,
          city: input.city ?? existing.city ?? undefined,
          qualificationStatus:
            existing.qualificationStatus === QualificationStatus.ACCEPTED
              ? existing.qualificationStatus
              : input.qualificationStatus,
          score: decimalScore ?? existing.score ?? undefined,
          enrichmentJson: toPrismaJson({
            ...(this.asObject(existing.enrichmentJson)),
            ...(input.enrichmentJson ?? {}),
          }),
        },
      });
    }

    const { firstName, lastName } = this.splitName(input.fullName);

    return this.prisma.contact.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        accountId: input.accountId ?? undefined,
        firstName,
        lastName,
        fullName: input.fullName,
        title: input.title ?? undefined,
        email: normalizedEmail,
        emailStatus: ContactEmailStatus.UNVERIFIED,
        city: input.city ?? undefined,
        qualificationStatus: input.qualificationStatus,
        score: decimalScore,
        enrichmentJson: toPrismaJson(input.enrichmentJson),
      },
    });
  }

  private splitName(fullName: string) {
    const normalized = fullName.trim().replace(/\s+/g, ' ');
    if (!normalized) return { firstName: null as string | null, lastName: null as string | null };
    const parts = normalized.split(' ');
    return {
      firstName: parts[0] ?? null,
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
    };
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
