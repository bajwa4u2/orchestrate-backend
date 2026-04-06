import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AgreementDeliveryService } from './agreement-delivery.service';
import { AgreementsService } from './agreements.service';
import { CreateServiceAgreementDto } from './dto/create-service-agreement.dto';

@Controller('agreements')
export class AgreementsController {
  constructor(
    private readonly agreementsService: AgreementsService,
    private readonly agreementDeliveryService: AgreementDeliveryService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.agreementsService.list(context.organizationId!, clientId);
  }

  @Get(':agreementId/render')
  async render(@Headers() headers: Record<string, unknown>, @Param('agreementId') agreementId: string) {
    await this.accessContextService.requireOperator(headers);
    return this.agreementDeliveryService.renderAgreement(agreementId);
  }

  @Post(':agreementId/send')
  async send(@Headers() headers: Record<string, unknown>, @Param('agreementId') agreementId: string) {
    await this.accessContextService.requireOperator(headers);
    return this.agreementDeliveryService.sendAgreementEmail(agreementId);
  }

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateServiceAgreementDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.agreementsService.create(context.organizationId!, context.userId, dto);
  }
}
