import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { SendTemplatedEmailDto } from './dto/send-templated-email.dto';
import { EmailsService } from './emails.service';

@Controller('emails')
export class EmailsController {
  constructor(
    private readonly emailsService: EmailsService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('dispatches')
  async listDispatches(@Headers() headers: Record<string, unknown>, @Query('clientId') clientId?: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.emailsService.listDispatches(context.organizationId!, clientId);
  }

  @Post('send-template')
  async sendTemplate(@Headers() headers: Record<string, unknown>, @Body() dto: SendTemplatedEmailDto) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.emailsService.sendTemplateEmail(context.organizationId!, context.userId, dto);
  }
}
