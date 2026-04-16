import {
  ActivityVisibility,
  Prisma,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { buildPagination } from '../common/utils/pagination';
import { PrismaService } from '../database/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkersService } from '../workers/workers.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowsService: WorkflowsService,
    private readonly workersService: WorkersService,
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

  async activateCampaign(input: { campaignId: string; organizationId: string }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        organizationId: input.organizationId,
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (campaign.status === 'ACTIVE') {
      return { ok: true, alreadyActive: true };
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'ACTIVE',
        generationState: 'ACTIVE',
      },
    });

    const job = await this.prisma.job.create({
      data: {
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        type: 'LEAD_IMPORT',
        status: 'QUEUED',
        queueName: 'activation',
        scheduledFor: new Date(),
        payloadJson: {
          campaignId: campaign.id,
        },
      },
    });

    await this.workersService.run(job, {
      workflowRunId: campaign.workflowRunId ?? undefined,
      payload: ((job.payloadJson ?? {}) as Record<string, unknown>) || {},
    });

    return { ok: true, jobId: job.id };
  }
}
