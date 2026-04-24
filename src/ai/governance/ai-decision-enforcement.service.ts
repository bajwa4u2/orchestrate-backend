import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { AiDecisionLinkService } from './ai-decision-link.service';
import {
  AiDecisionEnforcementRequest,
  AiDecisionEnforcementResult,
  AiGovernanceTrustMode,
} from './ai-governance.contract';

@Injectable()
export class AiDecisionEnforcementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: AiDecisionLinkService,
  ) {}

  async enforce(input: AiDecisionEnforcementRequest): Promise<AiDecisionEnforcementResult> {
    const decision = await this.prisma.aiDecisionRecord.findUnique({
      where: { id: input.decisionId },
    });

    if (!decision) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'NOT_FOUND',
        reason: `AI decision ${input.decisionId} was not found.`,
        trustMode: null,
        requiresHumanReview: true,
      });
    }

    if (input.organizationId && decision.organizationId !== input.organizationId) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'ENTITY_MISMATCH',
        reason: 'AI decision organization does not match enforcement request.',
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    const link = await this.links.ensureEntityMatch({
      decisionId: decision.id,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    if (!link) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'ENTITY_MISMATCH',
        reason: `AI decision ${decision.id} is not linked to ${input.entityType}:${input.entityId}.`,
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    if (input.scope && decision.scope !== input.scope) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'ENTITY_MISMATCH',
        reason: `AI decision scope ${decision.scope} does not match required scope ${input.scope}.`,
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    if (input.action && decision.action !== input.action && decision.effectiveAction !== input.action) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'ENTITY_MISMATCH',
        reason: `AI decision action ${decision.effectiveAction ?? decision.action} does not match required action ${input.action}.`,
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    if (decision.expiresAt && decision.expiresAt.getTime() < Date.now()) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'EXPIRED',
        reason: `AI decision ${decision.id} expired at ${decision.expiresAt.toISOString()}.`,
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    if (!decision.allowedToProceed) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'POLICY_BLOCKED',
        reason: decision.reason || 'AI decision blocked the action.',
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    if (decision.requiresHumanReview) {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'HUMAN_REVIEW_REQUIRED',
        reason: 'AI governance requires human review before this action may proceed.',
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    if (decision.trustMode !== 'trusted') {
      return this.persistAndReturn(input, {
        allowed: false,
        status: 'TRUST_BLOCKED',
        reason: `AI decision trust mode ${decision.trustMode ?? 'unknown'} does not allow autonomous enforcement.`,
        trustMode: this.readTrustMode(decision.trustMode),
        requiresHumanReview: true,
      });
    }

    await this.prisma.aiDecisionRecord.update({
      where: { id: decision.id },
      data: {
        status: 'ENFORCED',
        enforcedAt: new Date(),
      },
    });

    return this.persistAndReturn(input, {
      allowed: true,
      status: 'ALLOWED',
      reason: 'AI decision passed governance enforcement.',
      trustMode: 'trusted',
      requiresHumanReview: false,
    });
  }

  private async persistAndReturn(
    input: AiDecisionEnforcementRequest,
    result: Omit<AiDecisionEnforcementResult, 'ok' | 'decisionId'>,
  ): Promise<AiDecisionEnforcementResult> {
    await this.prisma.aiEnforcementRecord.create({
      data: {
        decisionId: result.status === 'NOT_FOUND' ? null : input.decisionId,
        organizationId: input.organizationId ?? 'unknown_organization',
        clientId: input.entity?.clientId ?? null,
        campaignId: input.entity?.campaignId ?? null,
        workflowRunId: input.workflowRunId ?? input.entity?.workflowRunId ?? null,
        jobId: input.jobId ?? input.entity?.jobId ?? null,
        serviceName: input.serviceName,
        methodName: input.methodName,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation,
        status: result.status,
        allowed: result.allowed,
        reason: result.reason,
        metadataJson: toPrismaJson({
          scope: input.scope ?? null,
          action: input.action ?? null,
          entity: input.entity ?? null,
          trustMode: result.trustMode,
          requiresHumanReview: result.requiresHumanReview,
          ...(input.metadata ?? {}),
        }),
      },
    });

    return {
      ok: result.allowed,
      allowed: result.allowed,
      status: result.status,
      reason: result.reason,
      decisionId: result.status === 'NOT_FOUND' ? null : input.decisionId,
      trustMode: result.trustMode,
      requiresHumanReview: result.requiresHumanReview,
    };
  }

  private readTrustMode(value: string | null | undefined): AiGovernanceTrustMode | null {
    if (value === 'blocked' || value === 'observe' || value === 'suggest' || value === 'trusted') {
      return value;
    }
    return null;
  }
}
