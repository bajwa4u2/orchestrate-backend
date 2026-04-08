import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';

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

  private getDb(db?: DbClient): DbClient {
    return db ?? this.prisma;
  }
}
