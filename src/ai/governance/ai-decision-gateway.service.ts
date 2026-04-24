import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { AiDecisionAuthorityService } from '../authority/ai-decision-authority.service';
import { AiDecisionRecorderService } from '../authority/ai-decision-recorder.service';
import { AiRealitySnapshotService } from '../authority/ai-reality-snapshot.service';
import { AiAuthorityEntityRef } from '../contracts/ai-authority.contract';
import { AiDecisionLinkService } from './ai-decision-link.service';
import { AiGovernancePolicyService } from './ai-governance-policy.service';
import {
  AiDecisionGatewayRequest,
  AiDecisionGatewayResult,
  AiGovernanceEntityLinkInput,
} from './ai-governance.contract';

@Injectable()
export class AiDecisionGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AiDecisionAuthorityService,
    private readonly snapshots: AiRealitySnapshotService,
    private readonly recorder: AiDecisionRecorderService,
    private readonly links: AiDecisionLinkService,
    private readonly policy: AiGovernancePolicyService,
  ) {}

  async decide(input: AiDecisionGatewayRequest): Promise<AiDecisionGatewayResult> {
    const snapshot = input.snapshot ?? (await this.snapshots.build({ scope: input.scope, entity: input.entity }));
    const authorityResult = await this.authority.decide({
      scope: input.scope,
      entity: input.entity,
      question: input.question,
      preferredAction: input.preferredAction,
      proposedJobType: input.proposedJobType ?? undefined,
      operatorNote: input.operatorNote,
      snapshot,
      dryRun: input.dryRun,
      recordDecision: false,
    });

    const evaluation = this.policy.evaluate({
      request: input,
      decision: authorityResult.decision,
    });

    if (input.dryRun) {
      return {
        ok: true,
        decisionId: null,
        decision: {
          ...authorityResult.decision,
          requiresHumanReview: evaluation.requiresHumanReview,
          metadata: {
            ...(authorityResult.decision.metadata ?? {}),
            governancePolicy: evaluation.policyBinding.metadata,
          },
        },
        snapshot,
        trustMode: evaluation.trustMode,
        automationAllowed: evaluation.automationAllowed,
        requiresHumanReview: evaluation.requiresHumanReview,
        expiresAt: evaluation.expiresAt?.toISOString() ?? null,
        policyReasons: evaluation.reasons,
        links: this.normalizeLinks(input.entity, input.entityLinks),
      };
    }

    const decisionRecord = await this.prisma.aiDecisionRecord.create({
      data: {
        organizationId: this.requireOrganizationId(snapshot.entity),
        clientId: snapshot.entity.clientId ?? null,
        campaignId: snapshot.entity.campaignId ?? null,
        workflowRunId: input.enforcement?.workflowRunId ?? snapshot.entity.workflowRunId ?? null,
        scope: input.scope,
        action: authorityResult.decision.action,
        effectiveAction: authorityResult.policy.normalizedAction ?? authorityResult.decision.action,
        actor: authorityResult.decision.actor,
        jobType: authorityResult.decision.jobType ?? null,
        allowedToProceed: authorityResult.decision.allowedToProceed,
        requiresHumanReview: evaluation.requiresHumanReview,
        confidence: this.toDecimal(authorityResult.decision.confidence),
        risk: authorityResult.decision.risk,
        reason: authorityResult.decision.reason,
        evidenceJson: toPrismaJson(authorityResult.decision.evidence),
        blockersJson: toPrismaJson(authorityResult.decision.blockers),
        notesJson: toPrismaJson(authorityResult.decision.notes ?? []),
        metadataJson: toPrismaJson({
          ...(input.metadata ?? {}),
          source: input.source,
          requestedAction: input.preferredAction,
          proposedJobType: input.proposedJobType ?? null,
          queueOrMutation: input.enforcement ?? null,
          authorityMetadata: authorityResult.decision.metadata ?? {},
        }),
        policyMetadataJson: toPrismaJson({
          authorityPolicy: authorityResult.policy,
          governancePolicy: evaluation.policyBinding.metadata,
          reasons: evaluation.reasons,
          mode: input.mode ?? 'required',
        }),
        snapshotVersion: snapshot.snapshotVersion,
        snapshotGeneratedAt: new Date(snapshot.generatedAt),
        trustMode: evaluation.trustMode,
        source: 'ai_governance_gateway',
        status: 'RECORDED',
        expiresAt: evaluation.expiresAt,
        enforcedAt: null,
      },
    });

    await this.prisma.aiDecisionPolicyBinding.create({
      data: {
        decisionId: decisionRecord.id,
        organizationId: decisionRecord.organizationId,
        clientId: decisionRecord.clientId ?? null,
        campaignId: decisionRecord.campaignId ?? null,
        scope: input.scope,
        action: input.preferredAction,
        bindingKey: `${input.scope}:${input.preferredAction}`,
        bindingValueJson: toPrismaJson({
          source: input.source,
          enforcement: input.enforcement ?? null,
          requestMetadata: input.metadata ?? null,
        }),
        trustMode: evaluation.policyBinding.trustMode,
        requiredConfidence: this.toDecimal(evaluation.policyBinding.requiredConfidence),
        requiresHumanReview: evaluation.policyBinding.requiresHumanReview,
        automationAllowed: evaluation.policyBinding.automationAllowed,
        status: 'ACTIVE',
        metadataJson: toPrismaJson(evaluation.policyBinding.metadata),
        effectiveFrom: new Date(),
        effectiveUntil: evaluation.policyBinding.expiresAt,
      },
    });

    await this.links.createLinks({
      decisionId: decisionRecord.id,
      organizationId: decisionRecord.organizationId,
      entity: snapshot.entity,
      extraLinks: input.entityLinks,
    });

    await this.recorder.record({
      decision: {
        ...authorityResult.decision,
        action: authorityResult.policy.normalizedAction ?? authorityResult.decision.action,
        jobType: authorityResult.policy.normalizedJobType ?? authorityResult.decision.jobType ?? null,
        requiresHumanReview: evaluation.requiresHumanReview,
        metadata: {
          ...(authorityResult.decision.metadata ?? {}),
          governance: {
            decisionId: decisionRecord.id,
            trustMode: evaluation.trustMode,
            automationAllowed: evaluation.automationAllowed,
            expiresAt: evaluation.expiresAt?.toISOString() ?? null,
            policyReasons: evaluation.reasons,
          },
        },
      },
      snapshot,
      policy: authorityResult.policy,
      source: 'ai_governance_gateway',
    });

    return {
      ok: true,
      decisionId: decisionRecord.id,
      decision: {
        ...authorityResult.decision,
        action: authorityResult.policy.normalizedAction ?? authorityResult.decision.action,
        jobType: authorityResult.policy.normalizedJobType ?? authorityResult.decision.jobType ?? null,
        requiresHumanReview: evaluation.requiresHumanReview,
      },
      snapshot,
      trustMode: evaluation.trustMode,
      automationAllowed: evaluation.automationAllowed,
      requiresHumanReview: evaluation.requiresHumanReview,
      expiresAt: evaluation.expiresAt?.toISOString() ?? null,
      policyReasons: evaluation.reasons,
      links: this.normalizeLinks(snapshot.entity, input.entityLinks),
    };
  }

  async findDecision(decisionId: string) {
    return this.prisma.aiDecisionRecord.findUnique({
      where: { id: decisionId },
      include: {
        links: true,
        enforcements: true,
        outcomes: true,
        bindings: true,
      },
    });
  }

  private normalizeLinks(entity: AiAuthorityEntityRef, extraLinks: AiGovernanceEntityLinkInput[] = []) {
    const links: AiGovernanceEntityLinkInput[] = [];
    const add = (entityType: string, entityId?: string | null, role: AiGovernanceEntityLinkInput['role'] = 'CONTEXT') => {
      if (!entityId) return;
      links.push({ entityType, entityId, role });
    };

    add('organization', entity.organizationId, 'CONTEXT');
    add('client', entity.clientId, 'CONTEXT');
    add('campaign', entity.campaignId, 'CONTEXT');
    add('lead', entity.leadId, 'PRIMARY_SUBJECT');
    add('reply', entity.replyId, 'PRIMARY_SUBJECT');
    add('meeting', entity.meetingId, 'PRIMARY_SUBJECT');
    add('invoice', entity.invoiceId, 'PRIMARY_SUBJECT');
    add('agreement', entity.agreementId, 'PRIMARY_SUBJECT');
    add('job', entity.jobId, 'RELATED');
    add('workflow_run', entity.workflowRunId, 'RELATED');

    const deduped = new Map<string, AiGovernanceEntityLinkInput>();
    for (const link of [...links, ...extraLinks]) {
      if (!link.entityType || !link.entityId) continue;
      const normalized = {
        entityType: link.entityType,
        entityId: link.entityId,
        role: link.role ?? 'CONTEXT',
        metadata: link.metadata ?? {},
      } satisfies AiGovernanceEntityLinkInput;
      deduped.set(`${normalized.entityType}:${normalized.entityId}:${normalized.role}`, normalized);
    }

    return Array.from(deduped.values());
  }

  private requireOrganizationId(entity: AiAuthorityEntityRef) {
    if (!entity.organizationId) {
      throw new Error('AI governance requires organizationId to persist durable decision records.');
    }
    return entity.organizationId;
  }

  private toDecimal(value: number | null | undefined): Prisma.Decimal | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return new Prisma.Decimal(value);
  }
}
