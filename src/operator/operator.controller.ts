import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { OperatorService } from './operator.service';
import { AssignInquiryDto } from './dto/assign-inquiry.dto';
import { CreateInquiryNoteDto } from './dto/create-inquiry-note.dto';
import { CreateInquiryReplyDto } from './dto/create-inquiry-reply.dto';
import { UpdateInquiryStatusDto } from './dto/update-inquiry-status.dto';

@Controller('operator')
export class OperatorController {
  constructor(
    private readonly operatorService: OperatorService,
    private readonly accessContextService: AccessContextService,
  ) {}

  @Get('command/overview')
  async commandOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.commandOverview(context.organizationId!);
  }

  @Get('revenue/overview')
  async revenueOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.revenueOverview(context.organizationId!);
  }

  @Get('records/overview')
  async recordsOverview(@Headers() headers: Record<string, unknown>) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.recordsOverview(context.organizationId!);
  }

  @Get('inquiries')
  async inquiries(
    @Headers() headers: Record<string, unknown>,
    @Query('limit') limit?: string,
  ) {
    await this.accessContextService.requireOperator(headers);
    return this.operatorService.listPublicInquiries(limit);
  }

  @Get('inquiries/:id')
  async inquiryDetail(
    @Headers() headers: Record<string, unknown>,
    @Param('id') id: string,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.getPublicInquiry(id, context.userId);
  }

  @Patch('inquiries/:id/status')
  async updateInquiryStatus(
    @Headers() headers: Record<string, unknown>,
    @Param('id') id: string,
    @Body() dto: UpdateInquiryStatusDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.updatePublicInquiryStatus(id, dto.status, context.userId);
  }

  @Patch('inquiries/:id/assign')
  async assignInquiry(
    @Headers() headers: Record<string, unknown>,
    @Param('id') id: string,
    @Body() dto: AssignInquiryDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    const requestedAssignee = dto.assignedToUserId?.trim();
    const assignedToUserId = requestedAssignee == 'me' ? context.userId : requestedAssignee;
    return this.operatorService.assignPublicInquiry(id, assignedToUserId, context.userId);
  }

  @Post('inquiries/:id/reply')
  async replyToInquiry(
    @Headers() headers: Record<string, unknown>,
    @Param('id') id: string,
    @Body() dto: CreateInquiryReplyDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.addInquiryReply(id, context.userId!, dto);
  }

  @Post('inquiries/:id/notes')
  async addInquiryNote(
    @Headers() headers: Record<string, unknown>,
    @Param('id') id: string,
    @Body() dto: CreateInquiryNoteDto,
  ) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.operatorService.addInquiryNote(id, context.organizationId!, context.userId!, dto);
  }
}
