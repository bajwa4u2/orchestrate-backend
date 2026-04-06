import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CreateStatementDto } from './dto/create-statement.dto';
import { StatementDeliveryService } from './statement-delivery.service';
import { StatementsService } from './statements.service';

@Controller('statements')
export class StatementsController {
  constructor(
    private readonly statementsService: StatementsService,
    private readonly statementDeliveryService: StatementDeliveryService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.statementsService.list(context.organizationId!, clientId);
  }

  @Get(':statementId/render')
  async render(@Headers() headers: Record<string, unknown>, @Param('statementId') statementId: string) {
    await this.accessContextService.requireOperator(headers);
    return this.statementDeliveryService.renderStatement(statementId);
  }

  @Post(':statementId/send')
  async send(@Headers() headers: Record<string, unknown>, @Param('statementId') statementId: string) {
    await this.accessContextService.requireOperator(headers);
    return this.statementDeliveryService.sendStatementEmail(statementId);
  }

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateStatementDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.statementsService.create(context.organizationId!, context.userId, dto);
  }
}
