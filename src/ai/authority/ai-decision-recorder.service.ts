import { Injectable, Logger } from '@nestjs/common';
import { ActivityKind, ActivityVisibility, Prisma } from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { AiAuthorityDecision, AiPolicyResult, AiRealitySnapshot } from '../contracts/ai-authority.contract';

@Injectable()
export class AiDecisionRecorderService {
  private readonly logger = new Logger(AiDecisionRecorderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    decision: AiAuthorityDecision;
    snapshot: AiRealitySnapshot;
    policy: AiPolicyResult;
    source?: string;
  }) {
    const organizationId = input.decision.entity.organizationId ?? input.snapshot.entity.organizationId;

    if (!organizationId) {
      this.logger.warn('AI decision was not recorded because organizationId is unavailable.');
      return null;
    }

    const subjectId =
      input.decision.entity.leadId ??
      input.decision.entity.campaignId ??
      input.decision.entity.clientId ??
      input.decision.entity.jobId ??
      input.decision.entity.workflowRunId ??
      organizationId;

    const summary = [
      `AI decision: ${input.decision.action}`,
      input.policy.allowed ? 'allowed' : 'blocked',
      input.decision.requiresHumanReview || input.policy.requiresHumanReview ? 'review required' : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return this.prisma.activityEvent.create({
      data: {
        organizationId,
        clientId: input.decision.entity.clientId ?? input.snapshot.entity.clientId ?? undefined,
        campaignId: input.decision.entity.campaignId ?? input.snapshot.entity.campaignId ?? undefined,
        workflowRunId: input.decision.entity.workflowRunId ?? input.snapshot.entity.workflowRunId ?? undefined,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.INTERNAL,
        subjectType: 'ai_decision',
        subjectId,
        summary,
        metadataJson: toPrismaJson({
          source: input.source ?? 'ai_authority',
          decision: input.decision,
          policy: input.policy,
          snapshotRef: {
            version: input.snapshot.snapshotVersion,
            generatedAt: input.snapshot.generatedAt,
            scope: input.snapshot.scope,
            entity: input.snapshot.entity,
            warnings: input.snapshot.warnings,
          },
        }) as Prisma.InputJsonValue,
      },
    });
  }
}
