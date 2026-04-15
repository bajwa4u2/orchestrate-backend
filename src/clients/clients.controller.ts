import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientSetupDto } from './dto/create-client-setup.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateClientDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.clientsService.create({
      ...dto,
      organizationId: context.organizationId!,
    });
  }

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query() query: ListClientsDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.clientsService.list({
      ...query,
      organizationId: context.organizationId!,
    });
  }

  @Get('me/setup')
  async getSetup(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.getSetup(headers);
  }

  @Post('me/setup')
  async saveSetup(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: CreateClientSetupDto,
  ) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.saveSetup(headers, dto);
  }

  @Post('me/deactivate')
  async deactivate(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.deactivateAccount(headers);
  }

  @Get('me/profile')
  async getProfile(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.getProfile(headers);
  }

  @Post('me/profile')
  async saveProfile(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: UpdateClientProfileDto,
  ) {
    await this.accessContextService.requireClient(headers);
    return this.clientsService.saveProfile(headers, dto);
  }
}
