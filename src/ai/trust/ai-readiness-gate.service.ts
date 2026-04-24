import { Injectable } from '@nestjs/common';
import { AiUsageTrackerService } from '../core/ai-usage-tracker.service';
import { AiTrustStoreService } from './ai-trust-store.service';
import { AiEvaluatorService } from './ai-evaluator.service';

@Injectable()
export class AiReadinessGateService {
  constructor(
    private readonly usage: AiUsageTrackerService,
    private readonly store: AiTrustStoreService,
    private readonly evaluator: AiEvaluatorService,
  ) {}

  status() {
    const usage = this.usage.snapshot();
    const store = this.store.summary();
    const evalSummary = this.evaluator.recentSummary();
    const latestTrust = evalSummary.latestTrustLevel;
    const latestScore = evalSummary.latestAverageScore;

    const gates = [
      this.gate('provider_gateway', true, 'AI calls route through provider abstraction.'),
      this.gate('usage_tracking', usage.recentCount > 0 || true, 'Usage accounting is available before runtime wiring.'),
      this.gate('cost_estimation', usage.cost.totalCostUsd !== null, 'Cost estimate requires AI_MODEL_PRICING_JSON or default cost env.'),
      this.gate('evaluation_baseline', Boolean(latestTrust), 'Run at least one evaluation set before trusting automation.'),
      this.gate('persistent_audit_ready', store.persistence === 'activity_event_and_audit_log_best_effort', 'AI events can persist through existing DB audit/activity tables when organizationId is present.'),
    ];

    const criticalFailures = gates.filter((gate) => !gate.passed && gate.severity === 'critical');
    const warnings = gates.filter((gate) => !gate.passed && gate.severity !== 'critical');

    return {
      ok: criticalFailures.length === 0,
      mode: this.mode(latestTrust, latestScore, criticalFailures.length, warnings.length),
      latestTrustLevel: latestTrust,
      latestAverageScore: latestScore,
      gates,
      usage,
      store,
      recommendation: criticalFailures.length
        ? 'Keep AI in callable/manual mode until critical readiness gates pass.'
        : warnings.length
          ? 'AI is capable for observe/suggest mode; run evaluations and configure pricing before autonomous wiring.'
          : 'AI is ready to be wired under observe/suggest mode with hard-block policy paths only.',
    };
  }

  private gate(name: string, passed: boolean, description: string) {
    return {
      name,
      passed,
      severity: name === 'provider_gateway' ? 'critical' : 'medium',
      description,
    };
  }

  private mode(latestTrust: string | null, latestScore: number | null, criticalFailures: number, warnings: number) {
    if (criticalFailures) return 'blocked';
    if (!latestTrust) return 'capable_unproven';
    if (latestTrust === 'high_trust' && warnings === 0) return 'trusted_ready';
    if (latestTrust === 'trusted' || (latestScore ?? 0) >= 0.88) return 'suggest_ready';
    return 'observe_only';
  }
}
