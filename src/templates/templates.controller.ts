import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.templatesService.list(context.organizationId!, clientId);
  }

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateTemplateDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.templatesService.create(context.organizationId!, dto);
  }

  @Post(':templateId/render')
  async render(
    @Headers() headers: Record<string, unknown>,
    @Param('templateId') templateId: string,
    @Body() variables: Record<string, unknown>,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.templatesService.render(context.organizationId!, templateId, variables);
  }
}
