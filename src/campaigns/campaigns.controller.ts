import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateCampaignDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.campaignsService.create({
      ...dto,
      organizationId: context.organizationId!,
      createdById: dto.createdById ?? context.userId,
    });
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query() query: ListCampaignsDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.campaignsService.list({
      ...query,
      organizationId: context.organizationId!,
    });
  }
}
