import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateOrganizationDto) {
    await this.accessContextService.requireOperator(headers);
    return this.organizationsService.create(dto);
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query() query: ListOrganizationsDto) {
    await this.accessContextService.requireOperator(headers);
    return this.organizationsService.list(query);
  }
}
