import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('alerts')
  async listAlerts(@Headers() headers: Record<string, unknown>, @Query() query: ListAlertsDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.notificationsService.listAlerts(context.organizationId!, query);
  }

  @Post('alerts')
  async createAlert(@Headers() headers: Record<string, unknown>, @Body() dto: CreateAlertDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.notificationsService.createAlert(context.organizationId!, context.userId, dto);
  }

  @Post('alerts/:alertId/resolve')
  async resolveAlert(@Headers() headers: Record<string, unknown>, @Param('alertId') alertId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.notificationsService.resolveAlert(context.organizationId!, alertId, context.userId);
  }
}
