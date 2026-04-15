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
      createdById: context.userId,
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
  getSetup(@Headers() headers: Record<string, unknown>) {
    return this.clientsService.getSetup(headers);
  }

  @Post('me/setup')
  saveSetup(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: CreateClientSetupDto,
  ) {
    return this.clientsService.saveSetup(headers, dto);
  }

  @Post('me/deactivate')
  deactivate(@Headers() headers: Record<string, unknown>) {
    return this.clientsService.deactivateAccount(headers);
  }

  @Get('me/profile')
  getProfile(@Headers() headers: Record<string, unknown>) {
    return this.clientsService.getProfile(headers);
  }

  @Post('me/profile')
  saveProfile(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: UpdateClientProfileDto,
  ) {
    return this.clientsService.saveProfile(headers, dto);
  }
}
