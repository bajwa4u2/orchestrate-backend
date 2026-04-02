import { Controller, Get, Query } from '@nestjs/common';
import { ControlService } from './control.service';

@Controller('control')
export class ControlController {
  constructor(private readonly controlService: ControlService) {}

  @Get('overview')
  overview(@Query('organizationId') organizationId?: string) {
    return this.controlService.overview(organizationId);
  }
}
