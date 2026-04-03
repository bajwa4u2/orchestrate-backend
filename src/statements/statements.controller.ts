import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CreateStatementDto } from './dto/create-statement.dto';
import { StatementsService } from './statements.service';

@Controller('statements')
export class StatementsController {
  constructor(
    private readonly statementsService: StatementsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.statementsService.list(context.organizationId!, clientId);
  }

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateStatementDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.statementsService.create(context.organizationId!, context.userId, dto);
  }
}
