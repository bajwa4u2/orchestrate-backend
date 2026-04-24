import { Injectable, Logger } from '@nestjs/common';
import { ActivityKind, ActivityVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AiAuthorityEntityRef } from '../contracts/ai-authority.contract';
import { AiEvaluationRunResult } from '../contracts/ai-trust.contract';
import { AiUsageRecord } from '../contracts/ai-core.contract';

type StoreKind =
  | 'ai_usage'
  | 'ai_decision'
  | 'ai_evaluation_run'
  | 'ai_outcome_feedback'
  | 'ai_readiness'
  | 'ai_system_doctor'
  | 'ai_self_correction'
  | 'ai_improvement_plan'
  | 'ai_trigger_plan'
  | 'ai_cost_guard';

export interface AiStoredRecord<T = unknown> {
  id: string;
  kind: StoreKind;
  entity: AiAuthorityEntityRef;
  payload: T;
  createdAt: string;
}

@Injectable()
export class AiTrustStoreService {
  private readonly logger = new Logger(AiTrustStoreService.name);
  private readonly memory: AiStoredRecord[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async record<T = unknown>(kind: StoreKind, payload: T, entity: AiAuthorityEntityRef = {}): Promise<AiStoredRecord<T>> {
    const record: AiStoredRecord<T> = {
      id: this.safeId(),
      kind,
      entity,
      payload,
      createdAt: new Date().toISOString(),
    };

    this.memory.push(record);
    if (this.memory.length > 2000) this.memory.shift();

    await this.persistBestEffort(record).catch((error) => {
      this.logger.debug(`AI trust store persistence skipped: ${error instanceof Error ? error.message : String(error)}`);
    });

    return record;
  }

  async recordUsage(usage: AiUsageRecord, entity: AiAuthorityEntityRef = {}) {
    return this.record('ai_usage', usage, entity);
  }

  async recordEvaluation(run: AiEvaluationRunResult, entity: AiAuthorityEntityRef = {}) {
    return this.record('ai_evaluation_run', run, entity);
  }

  recent(kind?: StoreKind, limit = 100) {
    const filtered = kind ? this.memory.filter((item) => item.kind === kind) : this.memory;
    return filtered.slice(-Math.max(1, Math.min(limit, 500)));
  }

  summary() {
    const byKind = this.memory.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1;
      return acc;
    }, {});

    return {
      memoryRecords: this.memory.length,
      byKind,
      latest: this.memory.slice(-10),
      persistence: 'activity_event_and_audit_log_best_effort',
    };
  }

  private async persistBestEffort(record: AiStoredRecord) {
    const organizationId = record.entity.organizationId;
    if (!organizationId) return;

    const subjectType = record.kind;
    const subjectId =
      record.entity.jobId ||
      record.entity.workflowRunId ||
      record.entity.leadId ||
      record.entity.campaignId ||
      record.entity.clientId ||
      organizationId;

    const summary = this.summaryFor(record);

    await this.prisma.activityEvent.create({
      data: {
        organizationId,
        clientId: record.entity.clientId ?? null,
        campaignId: record.entity.campaignId ?? null,
        workflowRunId: record.entity.workflowRunId ?? null,
        kind: ActivityKind.SYSTEM_ALERT,
        visibility: ActivityVisibility.INTERNAL,
        subjectType,
        subjectId,
        summary,
        metadataJson: this.safeJson(record),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: null,
        action: `AI_${record.kind.toUpperCase()}`,
        entityType: subjectType,
        entityId: subjectId,
        beforeJson: Prisma.JsonNull,
        afterJson: this.safeJson(record.payload),
        metadataJson: this.safeJson({ entity: record.entity, recordId: record.id, createdAt: record.createdAt }),
      },
    });
  }

  private summaryFor(record: AiStoredRecord) {
    const base = record.kind.replace(/_/g, ' ');
    const payload = record.payload as Record<string, unknown> | undefined;
    const purpose = payload && typeof payload === 'object' ? String(payload.purpose ?? payload.scope ?? '') : '';
    return ['AI', base, purpose].filter(Boolean).join(' — ').slice(0, 240);
  }

  private safeJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (item instanceof Error) return { message: item.message, stack: item.stack };
      return item;
    }));
  }

  private safeId() {
    return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
