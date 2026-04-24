import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiAuthorityAction,
  AiAuthorityDecision,
  AiAuthorityScope,
} from '../contracts/ai-authority.contract';
import { AiConfidenceGateService } from '../core/ai-confidence-gate.service';
import { AiEvaluatorService } from '../trust/ai-evaluator.service';
import { AiReadinessGateService } from '../trust/ai-readiness-gate.service';
import { AiTrustPolicyService } from '../trust/ai-trust-policy.service';
import {
  AiDecisionGatewayRequest,
  AiGovernanceDecisionMode,
  AiGovernancePolicyEvaluation,
  AiGovernanceTrustMode,
} from './ai-governance.contract';

@Injectable()
export class AiGovernancePolicyService {
  constructor(
    private readonly configService: ConfigService,
    private readonly readiness: AiReadinessGateService,
    private readonly trustPolicy: AiTrustPolicyService,
    private readonly evaluator: AiEvaluatorService,
    private readonly confidenceGate: AiConfidenceGateService,
  ) {}

  evaluate(input: {
    request: AiDecisionGatewayRequest;
    decision: AiAuthorityDecision;
  }): AiGovernancePolicyEvaluation {
    const readiness = this.readiness.status();
    const latestRun = this.evaluator.latestRun();
    const trust = this.trustPolicy.automationAllowedFor(latestRun);
    const threshold = this.confidenceGate.thresholdFor('authority.decision');
    const reasons: string[] = [];
    const mode: AiGovernanceDecisionMode = input.request.mode ?? 'required';

    let trustMode: AiGovernanceTrustMode = 'observe';
    if (readiness.mode === 'blocked') {
      trustMode = 'blocked';
      reasons.push('AI readiness is blocked.');
    } else if (trust.mode === 'trusted') {
      trustMode = 'trusted';
      reasons.push('Trust policy allows trusted automation for authority decisions.');
    } else if (trust.mode === 'suggest') {
      trustMode = 'suggest';
      reasons.push(trust.reason);
    } else {
      trustMode = 'observe';
      reasons.push(trust.reason);
    }

    if (!input.decision.allowedToProceed) {
      reasons.push('Authority decision did not allow the action to proceed.');
    }

    if (input.decision.confidence < threshold) {
      reasons.push(`Decision confidence ${input.decision.confidence} is below required threshold ${threshold}.`);
    }

    const automationAllowed =
      mode === 'required' &&
      trustMode === 'trusted' &&
      input.decision.allowedToProceed &&
      input.decision.confidence >= threshold;

    const requiresHumanReview =
      mode === 'audit_only' ||
      !automationAllowed ||
      input.decision.requiresHumanReview ||
      trustMode !== 'trusted';

    const expiresAt = this.resolveExpiry(input.request.scope, input.request.preferredAction, input.request.expiresInSeconds);

    return {
      trustMode,
      automationAllowed,
      requiresHumanReview,
      threshold,
      expiresAt,
      reasons,
      policyBinding: {
        scope: input.request.scope,
        action: input.request.preferredAction,
        trustMode,
        requiredConfidence: threshold,
        requiresHumanReview,
        automationAllowed,
        mode,
        expiresAt,
        metadata: {
          readinessMode: readiness.mode,
          latestTrustLevel: readiness.latestTrustLevel,
          latestAverageScore: readiness.latestAverageScore,
          trustPolicyMode: trust.mode,
          trustPolicyReason: trust.reason,
        },
      },
    };
  }

  private resolveExpiry(scope: AiAuthorityScope, action: AiAuthorityAction, explicitSeconds?: number) {
    const seconds =
      explicitSeconds ??
      this.decisionTtlSeconds(scope, action) ??
      Number(this.configService.get<string>('AI_GOVERNANCE_DEFAULT_TTL_SECONDS') || 3600);

    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(Date.now() + seconds * 1000);
  }

  private decisionTtlSeconds(scope: AiAuthorityScope, action: AiAuthorityAction) {
    const key = `AI_GOVERNANCE_TTL_${scope}_${action}`.replace(/\W/g, '_').toUpperCase();
    const specific = Number(this.configService.get<string>(key) || 0);
    if (specific > 0) return specific;

    switch (action) {
      case 'SEND_FIRST_OUTREACH':
      case 'SEND_FOLLOW_UP':
      case 'PROCESS_REPLY':
      case 'HANDOFF_MEETING':
        return Number(this.configService.get<string>('AI_GOVERNANCE_TTL_EXECUTION_SECONDS') || 1800);
      case 'ACTIVATE_CAMPAIGN':
      case 'SOURCE_LEADS':
      case 'ADAPT_STRATEGY':
      case 'QUALIFY_LEAD':
        return Number(this.configService.get<string>('AI_GOVERNANCE_TTL_GROWTH_SECONDS') || 7200);
      case 'GENERATE_AGREEMENT':
      case 'CREATE_INVOICE':
      case 'SEND_RECEIPT':
        return Number(this.configService.get<string>('AI_GOVERNANCE_TTL_REVENUE_SECONDS') || 14400);
      case 'DIAGNOSE_SYSTEM':
      case 'PROPOSE_CODE_UPGRADE':
      case 'PROPOSE_DESIGN_UPGRADE':
        return Number(this.configService.get<string>('AI_GOVERNANCE_TTL_DIAGNOSIS_SECONDS') || 21600);
      default:
        return null;
    }
  }
}
