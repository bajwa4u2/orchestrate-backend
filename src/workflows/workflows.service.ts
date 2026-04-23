import { Injectable } from '@nestjs/common';
import {
  JobStatus,
  JobType,
  Prisma,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { buildExecutionReadSurface } from '../common/utils/execution-read-surface';

type DbClient = PrismaService | Prisma.TransactionClient;

export interface WorkflowCreateInput {
  clientId: string;
  subscriptionId?: string | null;
  campaignId?: string | null;
  invoiceId?: string | null;
  serviceAgreementId?: string | null;
  statementId?: string | null;
  lane: WorkflowLane;
  type: WorkflowType;
  status?: WorkflowStatus;
  trigger?: WorkflowTrigger;
  source?: RecordSource;
  title?: string;
  inputJson?: Record<string, unknown> | null;
  contextJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  errorJson?: Record<string, unknown> | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
}

export interface WorkflowSubjectUpdateInput {
  subscriptionId?: string | null;
  campaignId?: string | null;
  invoiceId?: string | null;
  serviceAgreementId?: string | null;
  statementId?: string | null;
  title?: string | null;
  contextJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
}

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkflowRun(input: WorkflowCreateInput, db?: DbClient) {
    const client = await this.getDb(db).client.findUnique({
      where: { id: input.clientId },
      select: { organizationId: true },
    });

    if (!client) {
      throw new Error(`Client not found for workflow creation: ${input.clientId}`);
    }

    return this.getDb(db).workflowRun.create({
      data: {
        organizationId: client.organizationId,
        clientId: input.clientId,
        subscriptionId: input.subscriptionId ?? undefined,
        campaignId: input.campaignId ?? undefined,
        invoiceId: input.invoiceId ?? undefined,
        serviceAgreementId: input.serviceAgreementId ?? undefined,
        statementId: input.statementId ?? undefined,
        lane: input.lane,
        type: input.type,
        status: input.status ?? WorkflowStatus.PENDING,
        trigger: input.trigger ?? WorkflowTrigger.SYSTEM_EVENT,
        source: input.source ?? RecordSource.SYSTEM_GENERATED,
        title: input.title,
        inputJson: toPrismaJson(input.inputJson ?? null),
        contextJson: toPrismaJson(input.contextJson ?? null),
        resultJson: toPrismaJson(input.resultJson ?? null),
        errorJson: toPrismaJson(input.errorJson ?? null),
        startedAt: input.startedAt ?? undefined,
        completedAt: input.completedAt ?? undefined,
        failedAt: input.failedAt ?? undefined,
      },
    });
  }

  async startWorkflowRun(workflowRunId: string, contextJson?: Record<string, unknown> | null, db?: DbClient) {
    return this.getDb(db).workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: WorkflowStatus.RUNNING,
        startedAt: new Date(),
        ...(contextJson !== undefined ? { contextJson: toPrismaJson(contextJson) } : {}),
        failedAt: null,
      },
    });
  }

  async markWorkflowWaiting(workflowRunId: string, errorJson?: Record<string, unknown> | null, db?: DbClient) {
    return this.getDb(db).workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: WorkflowStatus.WAITING,
        ...(errorJson !== undefined ? { errorJson: toPrismaJson(errorJson) } : {}),
      },
    });
  }

  async completeWorkflowRun(workflowRunId: string, resultJson?: Record<string, unknown> | null, db?: DbClient) {
    return this.getDb(db).workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: WorkflowStatus.COMPLETED,
        completedAt: new Date(),
        failedAt: null,
        ...(resultJson !== undefined ? { resultJson: toPrismaJson(resultJson) } : {}),
      },
    });
  }

  async failWorkflowRun(workflowRunId: string, errorJson?: Record<string, unknown> | null, db?: DbClient) {
    return this.getDb(db).workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: WorkflowStatus.FAILED,
        failedAt: new Date(),
        ...(errorJson !== undefined ? { errorJson: toPrismaJson(errorJson) } : {}),
      },
    });
  }

  async attachWorkflowSubjects(workflowRunId: string, input: WorkflowSubjectUpdateInput, db?: DbClient) {
    return this.getDb(db).workflowRun.update({
      where: { id: workflowRunId },
      data: {
        ...(input.subscriptionId !== undefined ? { subscriptionId: input.subscriptionId } : {}),
        ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
        ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
        ...(input.serviceAgreementId !== undefined ? { serviceAgreementId: input.serviceAgreementId } : {}),
        ...(input.statementId !== undefined ? { statementId: input.statementId } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.contextJson !== undefined ? { contextJson: toPrismaJson(input.contextJson) } : {}),
        ...(input.resultJson !== undefined ? { resultJson: toPrismaJson(input.resultJson) } : {}),
      },
    });
  }

  async getCampaignExecutionSurface(campaignId: string, db?: DbClient) {
    const activeJobStatuses = [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED];
    const root = this.getDb(db);
    const campaign = await root.campaign.findUnique({
      where: { id: campaignId },
      select: { clientId: true, metadataJson: true },
    });

    const [workflow, queuedMessages, queuedSends, activeImports, waitingOnMailbox, sent, failed, replies, meetings, suppressionBlocked, consentBlocked] = await Promise.all([
      root.workflowRun.findFirst({ where: { campaignId }, orderBy: [{ createdAt: 'desc' }] }),
      root.job.count({ where: { campaignId, type: JobType.MESSAGE_GENERATION, status: { in: activeJobStatuses } } }),
      root.job.count({ where: { campaignId, type: { in: [JobType.FIRST_SEND, JobType.FOLLOWUP_SEND] }, status: { in: activeJobStatuses } } }),
      root.job.count({ where: { campaignId, type: JobType.LEAD_IMPORT, status: { in: activeJobStatuses } } }),
      root.outreachMessage.count({ where: { campaignId, status: 'QUEUED', OR: [{ mailboxId: null }, { sentAt: null }] } }),
      root.outreachMessage.count({ where: { campaignId, status: 'SENT' } }),
      root.job.count({ where: { campaignId, status: JobStatus.FAILED } }),
      root.reply.count({ where: { campaignId } }),
      root.meeting.count({ where: { campaignId } }),
      root.lead.count({ where: { campaignId, status: 'SUPPRESSED' } }),
      campaign?.clientId
        ? root.contactConsent.count({ where: { clientId: campaign.clientId, communication: 'OUTREACH', status: 'BLOCKED' } })
        : Promise.resolve(0),
    ]);

    const metadata = campaign && campaign.metadataJson && typeof campaign.metadataJson === 'object' && !Array.isArray(campaign.metadataJson)
      ? (campaign.metadataJson as Record<string, unknown>)
      : {};
    const activation = metadata.activation && typeof metadata.activation === 'object' && !Array.isArray(metadata.activation)
      ? (metadata.activation as Record<string, unknown>)
      : {};
    const bootstrapStatus = typeof activation.bootstrapStatus === 'string' ? activation.bootstrapStatus : null;

    const execution = buildExecutionReadSurface({
      waitingOnImport: activeImports,
      waitingOnMessageGeneration: queuedMessages,
      queuedForSend: queuedSends,
      waitingOnMailbox,
      blockedAtConsent: consentBlocked,
      blockedAtSuppression: suppressionBlocked,
      sent,
      failed,
      replies,
      meetings,
      bootstrapStatus,
    });

    return {
      workflowRunId: workflow?.id ?? null,
      workflowType: workflow?.type ?? null,
      startedAt: workflow?.startedAt ?? null,
      completedAt: workflow?.completedAt ?? null,
      failedAt: workflow?.failedAt ?? null,
      ...execution,
    };
  }

  private getDb(db?: DbClient): DbClient {
    return db ?? this.prisma;
  }
}
