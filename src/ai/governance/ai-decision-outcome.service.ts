import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { AiOutcomeFeedbackService } from '../trust/ai-outcome-feedback.service';
import { AiDecisionOutcomeInput } from './ai-governance.contract';

@Injectable()
export class AiDecisionOutcomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiOutcomeFeedback: AiOutcomeFeedbackService,
  ) {}

  async record(input: AiDecisionOutcomeInput) {
    const outcome = await this.prisma.aiDecisionOutcome.create({
      data: {
        decisionId: input.decisionId,
        organizationId: input.organizationId,
        clientId: input.clientId ?? null,
        campaignId: input.campaignId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        jobId: input.jobId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        outcomeType: input.outcomeType,
        status: input.status ?? 'OBSERVED',
        score: input.score ?? null,
        summary: input.summary ?? null,
        metadataJson: toPrismaJson(input.metadata ?? null),
        observedAt: input.observedAt ?? new Date(),
      },
    });

    await this.aiOutcomeFeedback.record({
      decisionId: input.decisionId,
      purpose: 'authority.decision',
      entity: {
        organizationId: input.organizationId,
        clientId: input.clientId ?? null,
        campaignId: input.campaignId ?? null,
        jobId: input.jobId ?? null,
        workflowRunId: input.workflowRunId ?? null,
      },
      actualOutcome: {
        entityType: input.entityType,
        entityId: input.entityId,
        outcomeType: input.outcomeType,
        status: input.status ?? 'OBSERVED',
        score: input.score ?? null,
        summary: input.summary ?? null,
        metadata: input.metadata ?? null,
      },
      success: input.status === 'SUCCEEDED' ? true : input.status === 'FAILED' ? false : undefined,
      notes: input.summary ?? undefined,
    });

    return outcome;
  }
}
