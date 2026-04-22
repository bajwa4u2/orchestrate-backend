import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { GenerateStrategyDto } from './dto/generate-strategy.dto';
import { StrategyService } from './strategy.service';

@Controller('strategy')
export class StrategyController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly strategyService: StrategyService,
  ) {}

  @Post('campaigns/:campaignId/generate')
  async generate(
    @Headers() headers: Record<string, unknown>,
    @Param('campaignId') campaignId: string,
    @Body() dto: GenerateStrategyDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.strategyService.generateForCampaign({
      campaignId,
      organizationId: context.organizationId!,
      preferredOpportunityType: dto.opportunityType,
    });
  }
}
