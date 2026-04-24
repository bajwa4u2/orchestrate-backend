import { Injectable } from '@nestjs/common';
import { AiEvaluationRunResult } from '../contracts/ai-trust.contract';

@Injectable()
export class AiTrustPolicyService {
  automationAllowedFor(run?: AiEvaluationRunResult | null) {
    if (!run) {
      return { allowed: false, mode: 'observe', reason: 'No evaluation baseline exists yet.' };
    }
    if (run.trustLevel === 'high_trust' && run.failedCases === 0) {
      return { allowed: true, mode: 'trusted', reason: 'Evaluation baseline passed at high trust.' };
    }
    if (run.trustLevel === 'trusted') {
      return { allowed: false, mode: 'suggest', reason: 'Trusted enough to suggest, not enough for autonomous action without integration-specific gates.' };
    }
    return { allowed: false, mode: 'observe', reason: `Current trust level is ${run.trustLevel}.` };
  }
}
