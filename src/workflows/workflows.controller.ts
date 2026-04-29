import { Controller, Get, Headers, Param } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('campaigns/:campaignId/execution-surface')
  async campaignExecutionSurface(
    @Headers() headers: Record<string, unknown>,
    @Param('campaignId') campaignId: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.workflowsService.getCampaignExecutionSurface(campaignId, {
      organizationId: context.organizationId!,
    });
  }
}
