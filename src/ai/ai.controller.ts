import { Body, Controller, Post } from '@nestjs/common';
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
  constructor(private readonly aiService: AiService) {}

  @Post('growth/activate')
  async activateGrowth(@Body() dto: ActivateGrowthWorkspaceDto) {
    return this.aiService.activateGrowthWorkspace(dto);
  }

  @Post('growth/messages/generate')
  async generateGrowthMessages(@Body() dto: GenerateGrowthMessagesDto) {
    return this.aiService.generateGrowthMessages(dto);
  }

  @Post('growth/sequence/generate')
  async generateGrowthSequence(@Body() dto: GenerateGrowthSequenceDto) {
    return this.aiService.generateGrowthSequence(dto);
  }

  @Post('revenue/reminder/generate')
  async generateReminder(@Body() dto: GenerateReminderDto) {
    return this.aiService.generateReminder(dto);
  }

  @Post('revenue/agreement/generate-draft')
  async generateAgreementDraft(@Body() dto: GenerateAgreementDraftDto) {
    return this.aiService.generateAgreementDraft(dto);
  }

  @Post('revenue/statement/generate-summary')
  async generateStatementSummary(@Body() dto: GenerateStatementSummaryDto) {
    return this.aiService.generateStatementSummary(dto);
  }
}