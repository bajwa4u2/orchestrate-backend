import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { CreateClientSetupDto } from './dto/create-client-setup.dto';

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
  getMySetup(@Headers() headers: Record<string, unknown>) {
    return this.clientsService.getMySetup(headers);
  }

  @Post('me/setup')
  saveMySetup(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: CreateClientSetupDto,
  ) {
    return this.clientsService.saveMySetup(headers, dto);
  }
}
