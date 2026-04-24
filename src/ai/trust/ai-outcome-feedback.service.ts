import { Injectable } from '@nestjs/common';
import { AiAuthorityEntityRef } from '../contracts/ai-authority.contract';
import { AiTrustStoreService } from './ai-trust-store.service';

export interface AiOutcomeFeedbackInput {
  decisionId?: string;
  purpose: string;
  entity?: AiAuthorityEntityRef;
  expectedOutcome?: unknown;
  actualOutcome: unknown;
  success?: boolean;
  operatorRating?: 1 | 2 | 3 | 4 | 5;
  notes?: string;
}

@Injectable()
export class AiOutcomeFeedbackService {
  constructor(private readonly store: AiTrustStoreService) {}

  async record(input: AiOutcomeFeedbackInput) {
    const score = this.score(input);
    const result = {
      ...input,
      score,
      trustImpact: this.impact(score),
      recordedAt: new Date().toISOString(),
    };
    await this.store.record('ai_outcome_feedback', result, input.entity ?? {});
    return result;
  }

  private score(input: AiOutcomeFeedbackInput) {
    if (typeof input.operatorRating === 'number') return Math.max(0, Math.min(1, input.operatorRating / 5));
    if (typeof input.success === 'boolean') return input.success ? 1 : 0;
    if (input.expectedOutcome !== undefined) {
      return JSON.stringify(input.expectedOutcome) === JSON.stringify(input.actualOutcome) ? 1 : 0.4;
    }
    return 0.5;
  }

  private impact(score: number) {
    if (score >= 0.9) return 'positive';
    if (score >= 0.65) return 'neutral';
    if (score >= 0.4) return 'warning';
    return 'negative';
  }
}
