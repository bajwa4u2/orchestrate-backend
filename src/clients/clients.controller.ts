import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientSetupDto } from './dto/create-client-setup.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  list(@Query() query: ListClientsDto) {
    return this.clientsService.list(query);
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
