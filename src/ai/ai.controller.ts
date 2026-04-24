import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AiService } from './ai.service';
import {
  AiAuthorityDecisionDto,
  AiCodeUpgradeDto,
  AiDesignReviewDto,
  AiRealitySnapshotDto,
  AiSystemDoctorDto,
} from './contracts/ai-authority.contract';
import {
  ActivateGrowthWorkspaceDto,
  GenerateAgreementDraftDto,
  GenerateGrowthMessagesDto,
  GenerateGrowthSequenceDto,
  GenerateReminderDto,
  GenerateStatementSummaryDto,
} from './contracts/ai.controller.contract';
import {
  AiDecisionScoreDto,
  AiEvaluationRunDto,
  AiImprovementPlanDto,
  AiOutcomeFeedbackDto,
  AiSelfCorrectionDto,
  AiSelfTriggerPlanDto,
} from './contracts/ai-trust.contract';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('capabilities/status')
  async capabilityStatus(@Headers() headers: Record<string, string>) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.aiCapabilityStatus();
  }

  @Get('trust/status')
  async trustStatus(@Headers() headers: Record<string, string>) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.aiTrustStatus();
  }

  @Get('trust/readiness')
  async readinessStatus(@Headers() headers: Record<string, string>) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.aiReadinessStatus();
  }

  @Get('trust/evaluation-sets')
  async evaluationSets(@Headers() headers: Record<string, string>) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.aiEvaluationSets();
  }

  @Post('trust/evaluate')
  async runEvaluation(@Headers() headers: Record<string, string>, @Body() dto: AiEvaluationRunDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.runAiEvaluation(dto);
  }

  @Post('trust/score')
  async scoreDecision(@Headers() headers: Record<string, string>, @Body() dto: AiDecisionScoreDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.scoreAiDecision(dto);
  }

  @Post('trust/outcome')
  async recordOutcome(@Headers() headers: Record<string, string>, @Body() dto: AiOutcomeFeedbackDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.recordAiOutcome(dto);
  }

  @Post('trust/self-correct')
  async selfCorrect(@Headers() headers: Record<string, string>, @Body() dto: AiSelfCorrectionDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.selfCorrectAiOutput(dto);
  }

  @Post('trust/self-improvement-plan')
  async selfImprovementPlan(@Headers() headers: Record<string, string>, @Body() dto: AiImprovementPlanDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.planAiSelfImprovement(dto);
  }

  @Post('trust/self-trigger-plan')
  async selfTriggerPlan(@Headers() headers: Record<string, string>, @Body() dto: AiSelfTriggerPlanDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.planAiSelfTriggers(dto);
  }

  @Post('growth/activate')
  async activateGrowth(@Headers() headers: Record<string, string>, @Body() dto: ActivateGrowthWorkspaceDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.activateGrowthWorkspace(dto);
  }

  @Post('growth/messages/generate')
  async generateGrowthMessages(@Headers() headers: Record<string, string>, @Body() dto: GenerateGrowthMessagesDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.generateGrowthMessages(dto);
  }

  @Post('growth/sequence/generate')
  async generateGrowthSequence(@Headers() headers: Record<string, string>, @Body() dto: GenerateGrowthSequenceDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.generateGrowthSequence(dto);
  }

  @Post('revenue/reminder/generate')
  async generateReminder(@Headers() headers: Record<string, string>, @Body() dto: GenerateReminderDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.generateReminder(dto);
  }

  @Post('revenue/agreement/generate-draft')
  async generateAgreementDraft(@Headers() headers: Record<string, string>, @Body() dto: GenerateAgreementDraftDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.generateAgreementDraft(dto);
  }

  @Post('revenue/statement/generate-summary')
  async generateStatementSummary(
    @Headers() headers: Record<string, string>,
    @Body() dto: GenerateStatementSummaryDto,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.generateStatementSummary(dto);
  }

  @Post('authority/snapshot')
  async buildRealitySnapshot(@Headers() headers: Record<string, string>, @Body() dto: AiRealitySnapshotDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.buildRealitySnapshot(dto);
  }

  @Post('authority/decide')
  async decide(@Headers() headers: Record<string, string>, @Body() dto: AiAuthorityDecisionDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.decide(dto);
  }

  @Post('system/diagnose')
  async diagnoseSystem(@Headers() headers: Record<string, string>, @Body() dto: AiSystemDoctorDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.diagnoseSystem(dto);
  }

  @Post('governance/code-upgrade')
  async planCodeUpgrade(@Headers() headers: Record<string, string>, @Body() dto: AiCodeUpgradeDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.planCodeUpgrade(dto);
  }

  @Post('governance/design-review')
  async reviewDesign(@Headers() headers: Record<string, string>, @Body() dto: AiDesignReviewDto) {
    await this.accessContextService.requireOperator(headers);
    return this.aiService.reviewDesign(dto);
  }
}
