import { Injectable } from '@nestjs/common';
import {
  AiDecisionScoreDto,
  AiEvaluationRunDto,
  AiImprovementPlanDto,
  AiOutcomeFeedbackDto,
  AiSelfCorrectionDto,
  AiSelfTriggerPlanDto,
} from '../contracts/ai-trust.contract';
import { AiAutonomyPlannerService } from './ai-autonomy-planner.service';
import { AiEvaluationCasesService } from './ai-evaluation-cases.service';
import { AiEvaluatorService } from './ai-evaluator.service';
import { AiOutcomeFeedbackService } from './ai-outcome-feedback.service';
import { AiReadinessGateService } from './ai-readiness-gate.service';
import { AiSelfCorrectionService } from './ai-self-correction.service';
import { AiSelfImprovementService } from './ai-self-improvement.service';
import { AiTrustScoreService } from './ai-trust-score.service';
import { AiTrustStoreService } from './ai-trust-store.service';
import { AiTrustPolicyService } from './ai-trust-policy.service';

@Injectable()
export class AiTrustService {
  constructor(
    private readonly cases: AiEvaluationCasesService,
    private readonly evaluator: AiEvaluatorService,
    private readonly scoring: AiTrustScoreService,
    private readonly correction: AiSelfCorrectionService,
    private readonly improvement: AiSelfImprovementService,
    private readonly autonomy: AiAutonomyPlannerService,
    private readonly outcomes: AiOutcomeFeedbackService,
    private readonly readiness: AiReadinessGateService,
    private readonly store: AiTrustStoreService,
    private readonly policy: AiTrustPolicyService,
  ) {}

  status() {
    const latest = this.evaluator.latestRun();
    return {
      ok: true,
      layer: 'ai_trust' as const,
      capabilities: {
        decisionScoring: true,
        accuracyTracking: true,
        automatedEvaluationSets: true,
        selfTriggerPlanning: true,
        selfCorrection: true,
        selfImprovementPlanning: true,
        outcomeFeedback: true,
        readinessGates: true,
        persistentTrustStore: true,
      },
      builtInEvaluationSets: this.cases.listSets().map((set) => ({
        id: set.id,
        title: set.title,
        version: set.version,
        caseCount: set.caseCount,
        domains: set.domains,
      })),
      readiness: this.readiness.status(),
      recentEvaluationSummary: this.evaluator.recentSummary(),
      trustPolicy: this.policy.automationAllowedFor(latest),
      store: this.store.summary(),
    };
  }

  readinessStatus() {
    return this.readiness.status();
  }

  evaluationSets() {
    return this.cases.listSets();
  }

  runEvaluation(input: AiEvaluationRunDto) {
    return this.evaluator.run(input);
  }

  score(input: AiDecisionScoreDto) {
    return this.scoring.score(input);
  }

  selfCorrect(input: AiSelfCorrectionDto) {
    return this.correction.correct(input);
  }

  improvementPlan(input: AiImprovementPlanDto) {
    return this.improvement.plan({
      ...input,
      evaluationRun: input.evaluationRun ?? this.evaluator.latestRun() ?? undefined,
    });
  }

  selfTriggerPlan(input: AiSelfTriggerPlanDto) {
    return this.autonomy.plan(input);
  }

  recordOutcome(input: AiOutcomeFeedbackDto) {
    return this.outcomes.record(input);
  }
}
