import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AgreementsService } from './agreements.service';
import { CreateServiceAgreementDto } from './dto/create-service-agreement.dto';

@Controller('agreements')
export class AgreementsController {
  constructor(
    private readonly agreementsService: AgreementsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.agreementsService.list(context.organizationId!, clientId);
  }

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateServiceAgreementDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.agreementsService.create(context.organizationId!, context.userId, dto);
  }
}
