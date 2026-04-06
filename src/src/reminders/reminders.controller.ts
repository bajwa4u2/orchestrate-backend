import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { RemindersService } from './reminders.service';

@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly remindersService: RemindersService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.remindersService.list(context.organizationId!, clientId);
  }

  @Post()
  async create(@Headers() headers: Record<string, unknown>, @Body() dto: CreateReminderDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.remindersService.create(context.organizationId!, context.userId, dto);
  }
}
