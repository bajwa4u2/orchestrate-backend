import { Controller, Get, Headers } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { ControlService } from './control.service';

@Controller('control')
export class ControlController {
  constructor(
    private readonly controlService: ControlService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('overview')
  async overview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.controlService.overview(context.organizationId!);
  }
}
