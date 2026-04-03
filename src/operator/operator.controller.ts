import { Controller, Get, Headers } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { OperatorService } from './operator.service';

@Controller('operator')
export class OperatorController {
  constructor(
    private readonly operatorService: OperatorService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('command/overview')
  async commandOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.commandOverview(context.organizationId!);
  }

  @Get('revenue/overview')
  async revenueOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.revenueOverview(context.organizationId!);
  }

  @Get('records/overview')
  async recordsOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.recordsOverview(context.organizationId!);
  }
}
