import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiDecisionAuthorityService } from '../authority/ai-decision-authority.service';
import { AiDecisionPolicyService } from '../authority/ai-decision-policy.service';
import { AiDecisionRecorderService } from '../authority/ai-decision-recorder.service';
import { AiRealitySnapshotService } from '../authority/ai-reality-snapshot.service';
import { AiCapabilityRegistryService } from '../core/ai-capability-registry.service';
import { AiConfidenceGateService } from '../core/ai-confidence-gate.service';
import { AiContextManagerService } from '../core/ai-context-manager.service';
import { AiCostPolicyService } from '../core/ai-cost-policy.service';
import { AiEngineService } from '../core/ai-engine.service';
import { AiLongContextService } from '../core/ai-long-context.service';
import { AiModelRouterService } from '../core/ai-model-router.service';
import { AiOutputValidatorService } from '../core/ai-output-validator.service';
import { AiStructuredRunnerService } from '../core/ai-structured-runner.service';
import { AiUsageTrackerService } from '../core/ai-usage-tracker.service';
import { AiCodeGovernorService } from './ai-code-governor.service';
import { AiDecisionEnforcementService } from './ai-decision-enforcement.service';
import { AiDecisionGatewayService } from './ai-decision-gateway.service';
import { AiDecisionLinkService } from './ai-decision-link.service';
import { AiDecisionOutcomeService } from './ai-decision-outcome.service';
import { AiGovernancePolicyService } from './ai-governance-policy.service';
import { AiSystemDoctorService } from '../intelligence/ai-system-doctor.service';
import { AiProviderRegistry } from '../providers/ai-provider.registry';
import { OpenAiProvider } from '../providers/openai.provider';
import { AiAutonomyPlannerService } from '../trust/ai-autonomy-planner.service';
import { AiEvaluationCasesService } from '../trust/ai-evaluation-cases.service';
import { AiEvaluatorService } from '../trust/ai-evaluator.service';
import { AiOutcomeFeedbackService } from '../trust/ai-outcome-feedback.service';
import { AiReadinessGateService } from '../trust/ai-readiness-gate.service';
import { AiSelfCorrectionService } from '../trust/ai-self-correction.service';
import { AiSelfImprovementService } from '../trust/ai-self-improvement.service';
import { AiTrustPolicyService } from '../trust/ai-trust-policy.service';
import { AiTrustScoreService } from '../trust/ai-trust-score.service';
import { AiTrustStoreService } from '../trust/ai-trust-store.service';
import { AiTrustService } from '../trust/ai-trust.service';

@Module({
  imports: [ConfigModule],
  providers: [
    AiRealitySnapshotService,
    AiDecisionAuthorityService,
    AiDecisionPolicyService,
    AiDecisionRecorderService,
    AiSystemDoctorService,
    AiCodeGovernorService,
    AiEngineService,
    AiCapabilityRegistryService,
    AiContextManagerService,
    AiLongContextService,
    AiModelRouterService,
    AiStructuredRunnerService,
    AiUsageTrackerService,
    AiCostPolicyService,
    AiConfidenceGateService,
    AiOutputValidatorService,
    AiProviderRegistry,
    OpenAiProvider,
    AiTrustService,
    AiEvaluationCasesService,
    AiEvaluatorService,
    AiTrustScoreService,
    AiSelfCorrectionService,
    AiSelfImprovementService,
    AiAutonomyPlannerService,
    AiOutcomeFeedbackService,
    AiReadinessGateService,
    AiTrustPolicyService,
    AiTrustStoreService,
    AiGovernancePolicyService,
    AiDecisionLinkService,
    AiDecisionOutcomeService,
    AiDecisionEnforcementService,
    AiDecisionGatewayService,
  ],
  exports: [
    AiRealitySnapshotService,
    AiDecisionAuthorityService,
    AiDecisionPolicyService,
    AiDecisionRecorderService,
    AiSystemDoctorService,
    AiCodeGovernorService,
    AiEngineService,
    AiCapabilityRegistryService,
    AiUsageTrackerService,
    AiProviderRegistry,
    AiTrustService,
    AiEvaluatorService,
    AiTrustScoreService,
    AiSelfCorrectionService,
    AiSelfImprovementService,
    AiAutonomyPlannerService,
    AiOutcomeFeedbackService,
    AiReadinessGateService,
    AiTrustPolicyService,
    AiTrustStoreService,
    AiCostPolicyService,
    AiConfidenceGateService,
    AiGovernancePolicyService,
    AiDecisionLinkService,
    AiDecisionOutcomeService,
    AiDecisionEnforcementService,
    AiDecisionGatewayService,
  ],
})
export class AiGovernanceModule {}
