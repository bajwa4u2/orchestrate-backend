import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { AssignInquiryDto } from './dto/assign-inquiry.dto';
import { CreateInquiryNoteDto } from './dto/create-inquiry-note.dto';
import { CreateInquiryReplyDto } from './dto/create-inquiry-reply.dto';
import { UpdateInquiryStatusDto } from './dto/update-inquiry-status.dto';
import { OperatorService } from './operator.service';

@Controller('operator')
export class OperatorController {
  constructor(
    private readonly operatorService: OperatorService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('command/overview')
  async commandOverview(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireOperator(headers);
    return this.operatorService.commandOverview();
  }

  @Get('command')
  async commandWorkspace(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireOperator(headers);
    return this.operatorService.commandWorkspace();
  }

  @Get('revenue/overview')
  async revenueOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.revenueOverview(context.organizationId!);
  }

  @Get('records/overview')
  async recordsOverview(@Headers() headers: Record<string, unknown>) {
    await this.accessContextService.requireOperator(headers);
    return this.operatorService.recordsOverview();
  }

  @Post('campaigns/:id/activate')
  async activateCampaignGlobal(
    @Headers() headers: Record<string, unknown>,
    @Param('id') campaignId: string,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.operatorService.activateCampaignGlobal(campaignId);
  }

  @Post('alerts/:id/resolve')
  async resolveAlertGlobal(
    @Headers() headers: Record<string, unknown>,
    @Param('id') alertId: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.resolveAlertGlobal(alertId, context.userId);
  }

  @Post('dispatch-due')
  async dispatchDueGlobal(
    @Headers() headers: Record<string, unknown>,
    @Body() body: { limit?: number } = {},
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.operatorService.dispatchDueJobsGlobal(body.limit);
  }

  @Get('inquiries')
  async inquiries(
    @Headers() headers: Record<string, unknown>,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.listPublicInquiries(context.organizationId!, {
      limit,
      status,
      q,
    });
  }

  @Get('inquiries/:id')
  async inquiryDetail(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.getInquiryDetail(context.organizationId!, inquiryId);
  }

  @Patch('inquiries/:id/status')
  async updateInquiryStatus(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
    @Body() dto: UpdateInquiryStatusDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.updateInquiryStatus(
      context.organizationId!,
      inquiryId,
      dto,
      context.userId!,
    );
  }

  // Temporary compatibility path for the current frontend call shape.
  @Post('inquiries/:id/status')
  async updateInquiryStatusCompat(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
    @Body() dto: UpdateInquiryStatusDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.updateInquiryStatus(
      context.organizationId!,
      inquiryId,
      dto,
      context.userId!,
    );
  }

  @Patch('inquiries/:id/assign')
  async assignInquiry(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
    @Body() dto: AssignInquiryDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.assignInquiry(
      context.organizationId!,
      inquiryId,
      dto,
      context.userId!,
    );
  }

  @Post('inquiries/:id/assign')
  async assignInquiryCompat(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
    @Body() dto: AssignInquiryDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.assignInquiry(
      context.organizationId!,
      inquiryId,
      dto,
      context.userId!,
    );
  }

  @Get('inquiries/:id/thread')
  async inquiryThread(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.getInquiryThread(context.organizationId!, inquiryId);
  }

  @Get('inquiries/:id/notes')
  async inquiryNotes(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.listInquiryNotes(context.organizationId!, inquiryId);
  }

  @Post('inquiries/:id/notes')
  async createInquiryNote(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
    @Body() dto: CreateInquiryNoteDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.createInquiryNote(
      context.organizationId!,
      inquiryId,
      dto,
      context.userId!,
    );
  }

  @Post('inquiries/:id/reply')
  async replyToInquiry(
    @Headers() headers: Record<string, unknown>,
    @Param('id') inquiryId: string,
    @Body() dto: CreateInquiryReplyDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.replyToInquiry(
      context.organizationId!,
      inquiryId,
      dto,
      context.userId!,
    );
  }
}
