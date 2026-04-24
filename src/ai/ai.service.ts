import { Injectable } from '@nestjs/common';
import { JobType } from '@prisma/client';
import {
  ActivateGrowthWorkspaceDto,
  GenerateAgreementDraftDto,
  GenerateGrowthMessagesDto,
  GenerateGrowthSequenceDto,
  GenerateReminderDto,
  GenerateStatementSummaryDto,
} from './contracts/ai.controller.contract';
import {
  AiAuthorityDecisionDto,
  AiCodeUpgradeDto,
  AiDesignReviewDto,
  AiRealitySnapshotDto,
  AiSystemDoctorDto,
} from './contracts/ai-authority.contract';
import {
  AiDecisionScoreDto,
  AiEvaluationRunDto,
  AiImprovementPlanDto,
  AiOutcomeFeedbackDto,
  AiSelfCorrectionDto,
  AiSelfTriggerPlanDto,
} from './contracts/ai-trust.contract';
import { AiDecisionAuthorityService } from './authority/ai-decision-authority.service';
import { AiRealitySnapshotService } from './authority/ai-reality-snapshot.service';
import { AiCodeGovernorService } from './governance/ai-code-governor.service';
import { AiSystemDoctorService } from './intelligence/ai-system-doctor.service';
import { AiGrowthService } from './services/ai-growth.service';
import { AiRevenueDraftsService } from './services/ai-revenue-drafts.service';
import { AiCapabilityRegistryService } from './core/ai-capability-registry.service';
import { AiUsageTrackerService } from './core/ai-usage-tracker.service';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import { AiTrustService } from './trust/ai-trust.service';

@Injectable()
export class AiService {
  constructor(
    private readonly growth: AiGrowthService,
    private readonly revenueDrafts: AiRevenueDraftsService,
    private readonly authority: AiDecisionAuthorityService,
    private readonly snapshots: AiRealitySnapshotService,
    private readonly systemDoctor: AiSystemDoctorService,
    private readonly codeGovernor: AiCodeGovernorService,
    private readonly providers: AiProviderRegistry,
    private readonly usage: AiUsageTrackerService,
    private readonly capabilities: AiCapabilityRegistryService,
    private readonly trust: AiTrustService,
  ) {}

  activateGrowthWorkspace(input: ActivateGrowthWorkspaceDto) {
    return this.growth.activateGrowthWorkspace(input);
  }

  bootstrapCampaignActivation(input: {
    clientId: string;
    campaignId: string;
    workflowRunId?: string;
    workflowTitle?: string;
  }) {
    return this.growth.bootstrapCampaignActivation(input);
  }

  generateOutboundDraftFromContext(input: {
    clientId: string;
    campaignId: string;
    leadId: string;
    stepOrderIndex: number;
    jobType: JobType;
    note?: string;
  }) {
    return this.growth.generateOutboundDraftFromContext(input);
  }

  generateGrowthMessages(input: GenerateGrowthMessagesDto) {
    return this.growth.generateGrowthMessages(input);
  }

  generateGrowthSequence(input: GenerateGrowthSequenceDto) {
    return this.growth.generateGrowthSequence(input);
  }

  generateReminder(input: GenerateReminderDto) {
    return this.revenueDrafts.generateReminder(input);
  }

  generateAgreementDraft(input: GenerateAgreementDraftDto) {
    return this.revenueDrafts.generateAgreementDraft(input);
  }

  generateStatementSummary(input: GenerateStatementSummaryDto) {
    return this.revenueDrafts.generateStatementSummary(input);
  }

  buildRealitySnapshot(input: AiRealitySnapshotDto) {
    return this.snapshots.build(input);
  }

  decide(input: AiAuthorityDecisionDto) {
    return this.authority.decide(input);
  }

  diagnoseSystem(input: AiSystemDoctorDto) {
    return this.systemDoctor.diagnose(input);
  }

  planCodeUpgrade(input: AiCodeUpgradeDto) {
    return this.codeGovernor.planCodeUpgrade(input);
  }

  reviewDesign(input: AiDesignReviewDto) {
    return this.codeGovernor.reviewDesign(input);
  }

  aiTrustStatus() {
    return this.trust.status();
  }

  aiReadinessStatus() {
    return this.trust.readinessStatus();
  }

  aiEvaluationSets() {
    return this.trust.evaluationSets();
  }

  runAiEvaluation(input: AiEvaluationRunDto) {
    return this.trust.runEvaluation(input);
  }

  scoreAiDecision(input: AiDecisionScoreDto) {
    return this.trust.score(input);
  }

  selfCorrectAiOutput(input: AiSelfCorrectionDto) {
    return this.trust.selfCorrect(input);
  }

  planAiSelfImprovement(input: AiImprovementPlanDto) {
    return this.trust.improvementPlan(input);
  }

  planAiSelfTriggers(input: AiSelfTriggerPlanDto) {
    return this.trust.selfTriggerPlan(input);
  }

  recordAiOutcome(input: AiOutcomeFeedbackDto) {
    return this.trust.recordOutcome(input);
  }

  aiCapabilityStatus() {
    return {
      ok: true,
      architecture: {
        mode: 'provider_gateway',
        decisionAuthority: true,
        systemDoctor: true,
        codeGovernor: true,
        designGovernor: true,
        structuredOutputs: true,
        modelRouting: true,
        usageTracking: true,
        costIntelligence: true,
        longContextPreparation: true,
        contextMemory: true,
        trustLayer: true,
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
      providers: this.providers.list(),
      usage: this.usage.snapshot(),
      trust: this.trust.status(),
      readiness: this.trust.readinessStatus(),
      capabilityMap: {
        authorityDecision: this.capabilities.capabilitiesForPurpose('authority.decision'),
        systemDoctor: this.capabilities.capabilitiesForPurpose('intelligence.system_doctor'),
        codeUpgrade: this.capabilities.capabilitiesForPurpose('governance.code_upgrade'),
        designReview: this.capabilities.capabilitiesForPurpose('governance.design_review'),
        intakeClassification: this.capabilities.capabilitiesForPurpose('classification.intake'),
        replyClassification: this.capabilities.capabilitiesForPurpose('classification.reply'),
        trustEvaluation: this.capabilities.capabilitiesForPurpose('evaluation.trust'),
        selfCorrection: this.capabilities.capabilitiesForPurpose('autonomy.self_correction'),
        selfImprovement: this.capabilities.capabilitiesForPurpose('autonomy.self_improvement'),
        selfTriggerPlanning: this.capabilities.capabilitiesForPurpose('autonomy.trigger_plan'),
      },
    };
  }
}
