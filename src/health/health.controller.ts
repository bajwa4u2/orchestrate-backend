import { Controller, Get, Headers } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async getHealth() {
    return this.healthService.getHealth();
  }

  @Get('live')
  live() {
    return this.healthService.live();
  }

  @Get('ready')
  ready() {
    return this.healthService.ready();
  }

  @Get('authorization-matrix')
  async authorizationMatrix(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireOperator(headers);
    return this.healthService.authorizationMatrix();
  }
}
