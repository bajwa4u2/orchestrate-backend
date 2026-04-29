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
import {
  AiDecisionGatewayService,
} from '../ai/governance/ai-decision-gateway.service';
import { AiDecisionEnforcementService } from '../ai/governance/ai-decision-enforcement.service';
import { AiDecisionLinkService } from '../ai/governance/ai-decision-link.service';
import {
  AiGovernanceDecisionMode,
  AiGovernanceEntityLinkInput,
  AiGovernanceSourceRef,
} from '../ai/governance/ai-governance.contract';
import {
  AiAuthorityAction,
  AiAuthorityEntityRef,
  AiAuthorityScope,
} from '../ai/contracts/ai-authority.contract';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { buildExecutionReadSurface } from '../common/utils/execution-read-surface';

type DbClient = PrismaService | Prisma.TransactionClient;

export interface WorkflowCreateInput {
  clientId: string;
  aiDecisionId?: string | null;
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
  governance?: {
    scope: AiAuthorityScope;
    action: AiAuthorityAction;
    entity: AiAuthorityEntityRef;
    source: AiGovernanceSourceRef;
    entityType: string;
    entityId: string;
    entityLinks?: AiGovernanceEntityLinkInput[];
    mode?: AiGovernanceDecisionMode;
    question?: string;
    operatorNote?: string;
    expiresInSeconds?: number;
    metadata?: Record<string, unknown>;
  };
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisionGateway: AiDecisionGatewayService,
    private readonly enforcement: AiDecisionEnforcementService,
    private readonly decisionLinks: AiDecisionLinkService,
  ) {}

  async createWorkflowRun(input: WorkflowCreateInput, db?: DbClient) {
    const root = this.getDb(db);
    const client = await root.client.findUnique({
      where: { id: input.clientId },
      select: { organizationId: true },
    });

    if (!client) {
      throw new Error(`Client not found for workflow creation: ${input.clientId}`);
    }

    let aiDecisionId = input.aiDecisionId ?? null;
    if (input.governance && !aiDecisionId) {
      const governanceDecision = await this.decisionGateway.decide({
        scope: input.governance.scope,
        entity: {
          organizationId: client.organizationId,
          clientId: input.clientId,
          campaignId: input.campaignId ?? input.governance.entity.campaignId ?? null,
          workflowRunId: null,
          ...input.governance.entity,
        },
        preferredAction: input.governance.action,
        source: input.governance.source,
        mode: input.governance.mode ?? 'required',
        enforcement: {
          entityType: input.governance.entityType,
          entityId: input.governance.entityId,
          operation: 'CREATE',
        },
        entityLinks: input.governance.entityLinks,
        expiresInSeconds: input.governance.expiresInSeconds,
        metadata: input.governance.metadata,
        question: input.governance.question,
        operatorNote: input.governance.operatorNote,
      });

      const enforcement = await this.enforcement.enforce({
        decisionId: governanceDecision.decisionId,
        organizationId: client.organizationId,
        scope: input.governance.scope,
        action: input.governance.action,
        entity: governanceDecision.snapshot.entity,
        serviceName: WorkflowsService.name,
        methodName: 'createWorkflowRun',
        entityType: input.governance.entityType,
        entityId: input.governance.entityId,
        operation: 'CREATE',
        metadata: {
          workflowType: input.type,
          workflowLane: input.lane,
        },
      });

      if (!enforcement.allowed) {
        throw new Error(`AI governance blocked workflow creation: ${enforcement.reason}`);
      }

      aiDecisionId = governanceDecision.decisionId;
    }

    const workflow = await root.workflowRun.create({
      data: {
        organizationId: client.organizationId,
        clientId: input.clientId,
        aiDecisionId: aiDecisionId ?? undefined,
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

    if (aiDecisionId) {
      await this.prisma.aiDecisionRecord.updateMany({
        where: {
          id: aiDecisionId,
          workflowRunId: null,
        },
        data: {
          workflowRunId: workflow.id,
        },
      });

      await this.decisionLinks.createLinks({
        decisionId: aiDecisionId,
        organizationId: client.organizationId,
        entity:
          input.governance?.entity ?? {
            organizationId: client.organizationId,
            clientId: input.clientId,
            campaignId: input.campaignId ?? null,
          },
        extraLinks: [
          ...(input.governance?.entityLinks ?? []),
          {
            entityType: 'workflow_run',
            entityId: workflow.id,
            role: 'RELATED',
            metadata: {
              lane: input.lane,
              type: input.type,
            },
          },
        ],
      });
    }

    return workflow;
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

  async getCampaignExecutionSurface(
    campaignId: string,
    scopeOrDb?: { organizationId?: string; clientId?: string } | DbClient,
    maybeDb?: DbClient,
  ) {
    const activeJobStatuses = [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED];
    const hasScope = scopeOrDb && ('organizationId' in scopeOrDb || 'clientId' in scopeOrDb);
    const scope = hasScope ? scopeOrDb as { organizationId?: string; clientId?: string } : {};
    const root = this.getDb(hasScope ? maybeDb : scopeOrDb as DbClient | undefined);
    const campaign = await root.campaign.findFirst({
      where: {
        id: campaignId,
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
        ...(scope.clientId ? { clientId: scope.clientId } : {}),
      },
      select: { id: true, organizationId: true, clientId: true, metadataJson: true },
    });

    if (!campaign) {
      return {
        workflowRunId: null,
        workflowType: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        state: 'NOT_FOUND',
        summary: 'Campaign was not found in the authorized scope.',
        failedJobs: [],
      };
    }

    const scopedWhere = {
      campaignId,
      organizationId: campaign.organizationId,
      clientId: campaign.clientId,
    };

    const [workflow, queuedMessages, queuedSends, activeImports, waitingOnMailbox, sent, failed, replies, meetings, suppressionBlocked, consentBlocked, failedJobs] = await Promise.all([
      root.workflowRun.findFirst({ where: scopedWhere, orderBy: [{ createdAt: 'desc' }] }),
      root.job.count({ where: { ...scopedWhere, type: JobType.MESSAGE_GENERATION, status: { in: activeJobStatuses } } }),
      root.job.count({ where: { ...scopedWhere, type: { in: [JobType.FIRST_SEND, JobType.FOLLOWUP_SEND] }, status: { in: activeJobStatuses } } }),
      root.job.count({ where: { ...scopedWhere, type: JobType.LEAD_IMPORT, status: { in: activeJobStatuses } } }),
      root.outreachMessage.count({ where: { ...scopedWhere, status: 'QUEUED', OR: [{ mailboxId: null }, { sentAt: null }] } }),
      root.outreachMessage.count({ where: { ...scopedWhere, status: 'SENT' } }),
      root.job.count({ where: { ...scopedWhere, status: JobStatus.FAILED } }),
      root.reply.count({ where: scopedWhere }),
      root.meeting.count({ where: scopedWhere }),
      root.lead.count({ where: { ...scopedWhere, status: 'SUPPRESSED' } }),
      root.contactConsent.count({ where: { organizationId: campaign.organizationId, clientId: campaign.clientId, communication: 'OUTREACH', status: 'BLOCKED' } }),
      root.job.findMany({
        where: { ...scopedWhere, status: JobStatus.FAILED },
        orderBy: [{ updatedAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          type: true,
          status: true,
          queueName: true,
          lastError: true,
          attemptCount: true,
          maxAttempts: true,
          updatedAt: true,
        },
      }),
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
      failedJobs,
      ...execution,
    };
  }

  private getDb(db?: DbClient): DbClient {
    return db ?? this.prisma;
  }
}
