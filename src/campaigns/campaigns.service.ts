import {
  ActivityVisibility,
  JobStatus,
  JobType,
  LeadStatus,
  MailboxConnectionState,
  MailboxHealthStatus,
  Prisma,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { buildPagination } from '../common/utils/pagination';
import { PrismaService } from '../database/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { DeliverabilityService } from '../deliverability/deliverability.service';
import { buildExecutionReadSurface } from '../common/utils/execution-read-surface';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowsService: WorkflowsService,
    private readonly deliverabilityService: DeliverabilityService,
  ) {}

  async create(dto: CreateCampaignDto) {
    if (!dto.organizationId) throw new Error('organizationId is required');
    if (!dto.clientId) throw new Error('clientId is required');

    return this.prisma.$transaction(async (tx) => {
      const workflow = await this.workflowsService.createWorkflowRun(
        {
          clientId: dto.clientId!,
          lane: WorkflowLane.GROWTH,
          type: WorkflowType.CAMPAIGN_GENERATION,
          status: WorkflowStatus.RUNNING,
          trigger: WorkflowTrigger.USER_ACTION,
          source: RecordSource.USER_CREATED,
          title: dto.name,
          inputJson: {
            organizationId: dto.organizationId,
            clientId: dto.clientId,
            icpId: dto.icpId ?? null,
            segmentId: dto.segmentId ?? null,
            createdById: dto.createdById ?? null,
            status: dto.status ?? null,
            channel: dto.channel ?? null,
            objective: dto.objective ?? null,
            offerSummary: dto.offerSummary ?? null,
            bookingUrlOverride: dto.bookingUrlOverride ?? null,
            dailySendCap: dto.dailySendCap ?? null,
            timezone: dto.timezone ?? null,
            startAt: dto.startAt?.toISOString() ?? null,
            endAt: dto.endAt?.toISOString() ?? null,
            metadataJson: dto.metadataJson ?? null,
          },
          contextJson: { stage: 'campaign_create' },
          startedAt: new Date(),
        },
        tx,
      );

      const campaign = await tx.campaign.create({
        data: {
          organizationId: dto.organizationId!,
          clientId: dto.clientId!,
          icpId: dto.icpId,
          segmentId: dto.segmentId,
          createdById: dto.createdById,
          workflowRunId: workflow.id,
          code: dto.code,
          name: dto.name,
          status: dto.status,
          source: RecordSource.USER_CREATED,
          generationState: 'INIT',
          channel: dto.channel,
          objective: dto.objective,
          offerSummary: dto.offerSummary,
          bookingUrlOverride: dto.bookingUrlOverride,
          dailySendCap: dto.dailySendCap,
          timezone: dto.timezone,
          startAt: dto.startAt,
          endAt: dto.endAt,
          metadataJson: toPrismaJson(dto.metadataJson),
        },
      });

      await tx.activityEvent.create({
        data: {
          organizationId: dto.organizationId!,
          clientId: dto.clientId!,
          campaignId: campaign.id,
          actorUserId: dto.createdById,
          workflowRunId: workflow.id,
          kind: 'CAMPAIGN_CREATED',
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'campaign',
          subjectId: campaign.id,
          summary: `Campaign ${campaign.name} created`,
          metadataJson: {
            campaignId: campaign.id,
            workflowRunId: workflow.id,
            source: RecordSource.USER_CREATED,
          } as Prisma.InputJsonValue,
        },
      });

      await this.workflowsService.attachWorkflowSubjects(workflow.id, { campaignId: campaign.id, title: campaign.name }, tx);
      await this.workflowsService.completeWorkflowRun(workflow.id, { campaignId: campaign.id }, tx);
      return campaign;
    });
  }

  async list(query: ListCampaignsDto) {
    const { page, limit, skip, take } = buildPagination(query.page, query.limit);
    const where = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { client: true, workflowRun: true },
        skip,
        take,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    const enriched = await Promise.all(items.map(async (item) => ({
      ...item,
      operational: await this.getCampaignOperationalView(item.id, item.organizationId, item.clientId),
    })));

    return { items: enriched, meta: { page, limit, total } };
  }


  async restartCampaign(input: { campaignId: string; organizationId?: string }) {
    return this.activateCampaign(input);
  }

  async activateCampaign(input: { campaignId: string; organizationId?: string }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, ...(input.organizationId ? { organizationId: input.organizationId } : {}) },
    });
    if (!campaign) throw new Error('Campaign not found');

    const infra = await this.deliverabilityService.ensureDefaultMailboxInfrastructure({
      organizationId: campaign.organizationId,
      clientId: campaign.clientId,
      timezone: campaign.timezone ?? undefined,
    });

    const metadata = this.asObject(campaign.metadataJson);
    const activation = this.asObject(metadata.activation);
    const activationVersion = this.readPositiveInt(activation.version) ?? 1;
    const dedupeKey = `campaign_activation:${campaign.id}:${activationVersion}`;

    if (campaign.status === 'ACTIVE' || campaign.generationState === 'ACTIVE') {
      const activeMetadata = {
        ...metadata,
        activation: {
          ...activation,
          version: activationVersion,
          bootstrapStatus: 'activation_completed',
          completedAt: this.readString(activation.completedAt) ?? this.readString(activation.lastBootstrapAt) ?? new Date().toISOString(),
          mailboxId: this.readString(activation.mailboxId) ?? infra.mailbox.id,
        },
      };
      if (this.readString(activation.bootstrapStatus) !== 'activation_completed') {
        await this.prisma.campaign.update({ where: { id: campaign.id }, data: { metadataJson: toPrismaJson(activeMetadata) } });
      }
      return {
        ok: true,
        status: 'active',
        generationState: campaign.generationState ?? 'ACTIVE',
        bootstrapStatus: 'activation_completed',
        deduped: true,
        message: 'Campaign is already active.',
        mailbox: this.toMailboxSurface(infra.mailbox),
        operational: await this.getCampaignOperationalView(campaign.id, campaign.organizationId, campaign.clientId),
      };
    }

    const existingActivationJob = await this.prisma.job.findFirst({
      where: {
        campaignId: campaign.id,
        type: JobType.LEAD_IMPORT,
        dedupeKey,
        status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingActivationJob) {
      const bootstrapStatus = existingActivationJob.status === JobStatus.RETRY_SCHEDULED ? 'activation_retry_scheduled' : 'activation_in_progress';
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'ACTIVE',
          generationState: 'TARGETING_READY',
          metadataJson: toPrismaJson({
            ...metadata,
            activation: {
              ...activation,
              version: activationVersion,
              requestedAt: this.readString(activation.requestedAt) ?? existingActivationJob.createdAt.toISOString(),
              bootstrapStatus,
              jobId: existingActivationJob.id,
              mailboxId: infra.mailbox.id,
              dedupeKey,
              retryAt: existingActivationJob.status === JobStatus.RETRY_SCHEDULED ? existingActivationJob.scheduledFor?.toISOString() ?? null : null,
            },
          }),
        },
      });

      return {
        ok: true,
        status: bootstrapStatus,
        generationState: 'TARGETING_READY',
        bootstrapStatus,
        jobId: existingActivationJob.id,
        mailbox: this.toMailboxSurface(infra.mailbox),
        operational: await this.getCampaignOperationalView(campaign.id, campaign.organizationId, campaign.clientId),
      };
    }

    const job = await this.prisma.job.create({
      data: {
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        type: JobType.LEAD_IMPORT,
        status: JobStatus.QUEUED,
        queueName: 'lead-import',
        dedupeKey,
        scheduledFor: new Date(),
        maxAttempts: 3,
        payloadJson: toPrismaJson({ campaignId: campaign.id }),
      },
    });

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'ACTIVE',
        generationState: 'TARGETING_READY',
        metadataJson: toPrismaJson({
          ...metadata,
          activation: {
            ...activation,
            version: activationVersion,
            requestedAt: new Date().toISOString(),
            bootstrapStatus: 'activation_requested',
            jobId: job.id,
            mailboxId: infra.mailbox.id,
            dedupeKey,
          },
        }),
      },
    });

    return {
      ok: true,
      status: 'activation_requested',
      generationState: 'TARGETING_READY',
      bootstrapStatus: 'activation_requested',
      jobId: job.id,
      mailbox: this.toMailboxSurface(infra.mailbox),
      operational: await this.getCampaignOperationalView(campaign.id, campaign.organizationId, campaign.clientId),
    };
  }

  async getCampaignOperationalView(campaignId: string, organizationId: string, clientId: string) {
    const activeJobStatuses = [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED];
    const [campaign, messageGeneration, sendQueue, activeImports, mailbox, sent, failed, replies, meetings, suppressionBlocked, consentBlocked, executionSurface] = await Promise.all([
      this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { metadataJson: true, generationState: true, status: true, dailySendCap: true } }),
      this.prisma.job.count({ where: { organizationId, clientId, campaignId, type: JobType.MESSAGE_GENERATION, status: { in: activeJobStatuses } } }),
      this.prisma.job.count({ where: { organizationId, clientId, campaignId, type: { in: [JobType.FIRST_SEND, JobType.FOLLOWUP_SEND] }, status: { in: activeJobStatuses } } }),
      this.prisma.job.count({ where: { organizationId, clientId, campaignId, type: JobType.LEAD_IMPORT, status: { in: activeJobStatuses } } }),
      this.deliverabilityService.pickMailboxForClient({ organizationId, clientId }),
      this.prisma.outreachMessage.count({ where: { organizationId, clientId, campaignId, status: 'SENT' } }),
      this.prisma.outreachMessage.count({ where: { organizationId, clientId, campaignId, status: 'FAILED' } }),
      this.prisma.reply.count({ where: { organizationId, clientId, campaignId } }),
      this.prisma.meeting.count({ where: { organizationId, clientId, campaignId } }),
      this.prisma.lead.count({ where: { organizationId, clientId, campaignId, status: LeadStatus.SUPPRESSED } }),
      this.prisma.contactConsent.count({ where: { organizationId, clientId, communication: 'OUTREACH', status: 'BLOCKED' } }),
      this.workflowsService.getCampaignExecutionSurface(campaignId),
    ]);
    const metadata = this.asObject(campaign?.metadataJson);
    const activation = this.asObject(metadata.activation);
    const waitingOnMailbox = !mailbox || mailbox.connectionState === MailboxConnectionState.REQUIRES_REAUTH || mailbox.connectionState === MailboxConnectionState.REVOKED || mailbox.healthStatus === MailboxHealthStatus.CRITICAL;
    const execution = buildExecutionReadSurface({
      waitingOnImport: activeImports,
      waitingOnMessageGeneration: messageGeneration,
      queuedForSend: sendQueue,
      waitingOnMailbox,
      blockedAtConsent: consentBlocked,
      blockedAtSuppression: suppressionBlocked,
      sent,
      failed,
      replies,
      meetings,
      bootstrapStatus: this.readString(activation.bootstrapStatus),
      workflowStatus: (executionSurface as any)?.workflowStatus ?? null,
      mailboxReady: !waitingOnMailbox,
    });
    return {
      campaignStatus: campaign?.status ?? null,
      generationState: campaign?.generationState ?? null,
      bootstrapStatus: this.readString(activation.bootstrapStatus),
      waitingOnMessageGeneration: messageGeneration,
      queuedForSend: sendQueue,
      sent,
      failed,
      mailbox: mailbox ? this.toMailboxSurface(mailbox) : null,
      waitingOnMailbox,
      dailySendCap: campaign?.dailySendCap ?? null,
      replies,
      meetings,
      blockedAtSuppression: suppressionBlocked,
      blockedAtConsent: consentBlocked,
      execution,
      workflow: executionSurface,
    };
  }

  private toMailboxSurface(mailbox: any) {
    return {
      id: mailbox.id,
      emailAddress: mailbox.emailAddress,
      label: mailbox.label,
      status: mailbox.status,
      connectionState: mailbox.connectionState,
      healthStatus: mailbox.healthStatus,
      isClientOwned: mailbox.isClientOwned,
    };
  }

  private asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  }

  private readPositiveInt(value: unknown): number | null {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }
}
