import { Body, Controller, Headers, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AiService } from './ai.service';
import {
  ActivateGrowthWorkspaceDto,
  GenerateAgreementDraftDto,
  GenerateGrowthMessagesDto,
  GenerateGrowthSequenceDto,
  GenerateReminderDto,
  GenerateStatementSummaryDto,
} from './contracts/ai.controller.contract';

@Controller('v1/ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly accessContextService: AccessContextService,
  ) {}

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
}
