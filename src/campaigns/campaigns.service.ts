import {
  ActivityVisibility,
  JobStatus,
  JobType,
  LeadStatus,
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
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async create(dto: CreateCampaignDto) {
    if (!dto.organizationId) {
      throw new Error('organizationId is required');
    }
    if (!dto.clientId) {
      throw new Error('clientId is required');
    }

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
          contextJson: {
            stage: 'campaign_create',
          },
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

      await this.workflowsService.attachWorkflowSubjects(
        workflow.id,
        {
          campaignId: campaign.id,
          title: campaign.name,
        },
        tx,
      );

      await this.workflowsService.completeWorkflowRun(
        workflow.id,
        {
          campaignId: campaign.id,
        },
        tx,
      );

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

    return { items, meta: { page, limit, total } };
  }

  async activateCampaign(input: { campaignId: string; organizationId?: string }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

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
          completedAt:
            this.readString(activation.completedAt) ??
            this.readString(activation.lastBootstrapAt) ??
            new Date().toISOString(),
        },
      };

      if (this.readString(activation.bootstrapStatus) !== 'activation_completed') {
        await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: {
            metadataJson: toPrismaJson(activeMetadata),
          },
        });
      }

      return {
        ok: true,
        status: 'active',
        generationState: campaign.generationState ?? 'ACTIVE',
        bootstrapStatus: 'activation_completed',
        deduped: true,
        message: 'Campaign is already active.',
      };
    }

    const existingActivationJob = await this.prisma.job.findFirst({
      where: {
        campaignId: campaign.id,
        type: JobType.LEAD_IMPORT,
        dedupeKey,
        status: {
          in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingActivationJob) {
      const bootstrapStatus =
        existingActivationJob.status === JobStatus.RETRY_SCHEDULED
          ? 'activation_retry_scheduled'
          : 'activation_in_progress';

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
              requestedAt:
                this.readString(activation.requestedAt) ?? existingActivationJob.createdAt.toISOString(),
              bootstrapStatus,
              jobId: existingActivationJob.id,
              dedupeKey,
              retryAt:
                existingActivationJob.status === JobStatus.RETRY_SCHEDULED
                  ? existingActivationJob.scheduledFor?.toISOString() ?? null
                  : null,
            },
          }),
        },
      });

      return {
        ok: true,
        status: 'activating',
        generationState: 'TARGETING_READY',
        bootstrapStatus,
        jobId: existingActivationJob.id,
        deduped: true,
        message:
          bootstrapStatus === 'activation_retry_scheduled'
            ? 'Campaign activation is waiting for its retry window.'
            : 'Campaign activation is already in progress.',
      };
    }

    const requestedAt = new Date();
    const nextMetadata = {
      ...metadata,
      activation: {
        ...activation,
        version: activationVersion,
        requestedAt: requestedAt.toISOString(),
        bootstrapStatus: 'activation_requested',
        lastError: null,
        retryAt: null,
        failedAt: null,
        completedAt: null,
        dedupeKey,
      },
    };

    const activatedCampaign = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'ACTIVE',
        generationState: 'TARGETING_READY',
        metadataJson: toPrismaJson(nextMetadata),
      },
    });

    const job = await this.prisma.job.create({
      data: {
        organizationId: activatedCampaign.organizationId,
        clientId: activatedCampaign.clientId,
        campaignId: activatedCampaign.id,
        type: JobType.LEAD_IMPORT,
        status: JobStatus.QUEUED,
        queueName: 'activation',
        dedupeKey,
        scheduledFor: requestedAt,
        payloadJson: {
          campaignId: activatedCampaign.id,
          workflowRunId: activatedCampaign.workflowRunId ?? null,
          activationVersion,
          requestedAt: requestedAt.toISOString(),
        },
      },
    });

    await this.prisma.campaign.update({
      where: { id: activatedCampaign.id },
      data: {
        metadataJson: toPrismaJson({
          ...nextMetadata,
          activation: {
            ...this.asObject(nextMetadata.activation),
            jobId: job.id,
          },
        }),
      },
    });

    return {
      ok: true,
      status: 'activating',
      generationState: 'TARGETING_READY',
      bootstrapStatus: 'activation_requested',
      jobId: job.id,
      deduped: false,
      message: 'Campaign activation has started. We are preparing the first lead bootstrap now.',
    };
  }


  async restartCampaign(input: { campaignId: string; organizationId: string }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        workflowRunId: true,
        status: true,
        metadataJson: true,
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const metadata = this.asObject(campaign.metadataJson);
    const activation = this.asObject(metadata.activation);
    const restart = this.asObject(metadata.restart);
    const currentVersion = this.readPositiveInt(activation.version) ?? 1;
    const nextVersion = currentVersion + 1;
    const requestedAt = new Date();
    const dedupeKey = `campaign_activation:${campaign.id}:${nextVersion}`;
    const cancelableJobStatuses = [JobStatus.QUEUED, JobStatus.RETRY_SCHEDULED];
    const nowIso = requestedAt.toISOString();

    const nextMetadata = {
      ...metadata,
      activation: {
        ...activation,
        version: nextVersion,
        requestedAt: nowIso,
        bootstrapStatus: 'activation_requested',
        lastError: null,
        retryAt: null,
        failedAt: null,
        completedAt: null,
        dedupeKey,
      },
      restart: {
        ...restart,
        requestedAt: nowIso,
        previousVersion: currentVersion,
        version: nextVersion,
        source: 'client_campaign_restart',
      },
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.job.updateMany({
        where: {
          campaignId: campaign.id,
          type: { in: [JobType.LEAD_IMPORT, JobType.FIRST_SEND, JobType.FOLLOWUP_SEND] },
          status: { in: cancelableJobStatuses },
        },
        data: {
          status: JobStatus.CANCELED,
          finishedAt: requestedAt,
          lastError: 'Canceled by campaign restart with updated targeting.',
        },
      });

      await tx.lead.updateMany({
        where: {
          campaignId: campaign.id,
          status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] },
          firstContactAt: null,
          lastContactAt: null,
        },
        data: {
          status: LeadStatus.SUPPRESSED,
          suppressionReason: 'Replaced by campaign restart using updated targeting.',
        },
      });

      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'ACTIVE',
          generationState: 'TARGETING_READY',
          metadataJson: toPrismaJson(nextMetadata),
        },
      });

      const job = await tx.job.create({
        data: {
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          campaignId: campaign.id,
          type: JobType.LEAD_IMPORT,
          status: JobStatus.QUEUED,
          queueName: 'activation',
          dedupeKey,
          scheduledFor: requestedAt,
          payloadJson: {
            campaignId: campaign.id,
            workflowRunId: campaign.workflowRunId ?? null,
            activationVersion: nextVersion,
            requestedAt: nowIso,
            restartMode: 'targeting_restart',
          },
        },
      });

      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          metadataJson: toPrismaJson({
            ...nextMetadata,
            activation: {
              ...this.asObject(nextMetadata.activation),
              jobId: job.id,
            },
          }),
        },
      });
    });

    return {
      ok: true,
      status: 'activating',
      generationState: 'TARGETING_READY',
      bootstrapStatus: 'activation_requested',
      deduped: false,
      message: 'Campaign restart has started. We are applying your updated targeting now.',
    };
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readPositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }
}
