import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiEngineRequest, AiUsageRecord } from '../contracts/ai-core.contract';

interface PricePair {
  inputPerMillion: number;
  outputPerMillion: number;
}

@Injectable()
export class AiCostPolicyService {
  constructor(private readonly configService: ConfigService) {}

  estimateCostUsd(model: string, inputTokens: number, outputTokens: number) {
    const pricing = this.pricingFor(model);
    if (!pricing) return null;
    const cost = (inputTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion;
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  assertAllowed(request: AiEngineRequest, projectedInputTokens = 0) {
    const maxTokens = Number(this.configService.get<string>('AI_MAX_INPUT_TOKENS_PER_CALL') || 0);
    if (maxTokens > 0 && projectedInputTokens > maxTokens) {
      return {
        allowed: false,
        reason: `AI input too large for direct call (${projectedInputTokens} tokens > ${maxTokens}). Use long-context compression first.`,
      };
    }

    const disabledPurposes = this.csv(this.configService.get<string>('AI_DISABLED_PURPOSES'));
    if (disabledPurposes.includes(request.purpose)) {
      return { allowed: false, reason: `AI purpose disabled by policy: ${request.purpose}` };
    }

    return { allowed: true, reason: null };
  }

  budgetSnapshot(records: AiUsageRecord[]) {
    const totalCostUsd = records.reduce((sum, item) => sum + Number(item.estimatedCostUsd ?? 0), 0);
    const byPurpose = records.reduce<Record<string, { tokens: number; costUsd: number; calls: number }>>((acc, item) => {
      const key = item.purpose;
      acc[key] = acc[key] ?? { tokens: 0, costUsd: 0, calls: 0 };
      acc[key].tokens += item.totalTokens;
      acc[key].costUsd += Number(item.estimatedCostUsd ?? 0);
      acc[key].calls += 1;
      return acc;
    }, {});

    return {
      calls: records.length,
      totalTokens: records.reduce((sum, item) => sum + item.totalTokens, 0),
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      byPurpose,
      configuredBudgetUsdDaily: Number(this.configService.get<string>('AI_DAILY_BUDGET_USD') || 0) || null,
    };
  }

  private pricingFor(model: string): PricePair | null {
    const configured = this.configuredPricing();
    if (configured[model]) return configured[model];

    const normalized = model.toLowerCase();
    for (const [key, value] of Object.entries(configured)) {
      if (normalized.includes(key.toLowerCase())) return value;
    }

    const defaultInput = Number(this.configService.get<string>('AI_DEFAULT_INPUT_USD_PER_1M') || 0);
    const defaultOutput = Number(this.configService.get<string>('AI_DEFAULT_OUTPUT_USD_PER_1M') || 0);
    if (defaultInput > 0 || defaultOutput > 0) {
      return { inputPerMillion: defaultInput, outputPerMillion: defaultOutput };
    }

    return null;
  }

  private configuredPricing(): Record<string, PricePair> {
    const raw = this.configService.get<string>('AI_MODEL_PRICING_JSON') || this.configService.get<string>('OPENAI_MODEL_PRICING_JSON');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<PricePair>>;
      return Object.fromEntries(
        Object.entries(parsed).map(([model, value]) => [
          model,
          {
            inputPerMillion: Number(value.inputPerMillion ?? 0),
            outputPerMillion: Number(value.outputPerMillion ?? 0),
          },
        ]),
      );
    } catch {
      return {};
    }
  }

  private csv(value?: string | null) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
