import { Injectable, Logger } from '@nestjs/common';
import { AiEngineResult, AiUsageRecord } from '../contracts/ai-core.contract';
import { AiCostPolicyService } from './ai-cost-policy.service';

@Injectable()
export class AiUsageTrackerService {
  private readonly logger = new Logger(AiUsageTrackerService.name);
  private readonly recent: AiUsageRecord[] = [];

  constructor(private readonly costPolicy: AiCostPolicyService) {}

  record(result: AiEngineResult) {
    this.recent.push(result.usage);
    if (this.recent.length > 2000) this.recent.shift();

    this.logger.debug(
      `AI usage ${result.purpose} via ${result.provider}/${result.model}: ${result.usage.totalTokens} tokens in ${result.usage.latencyMs}ms cost=${result.usage.estimatedCostUsd ?? 'unpriced'}`,
    );
  }

  snapshot() {
    const totalTokens = this.recent.reduce((sum, item) => sum + item.totalTokens, 0);
    const byPurpose = this.recent.reduce<Record<string, number>>((acc, item) => {
      acc[item.purpose] = (acc[item.purpose] ?? 0) + item.totalTokens;
      return acc;
    }, {});

    return {
      recentCount: this.recent.length,
      totalTokens,
      byPurpose,
      cost: this.costPolicy.budgetSnapshot(this.recent),
      latest: this.recent.slice(-20),
    };
  }

  records() {
    return [...this.recent];
  }
}
