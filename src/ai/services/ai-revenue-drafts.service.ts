import { Injectable } from '@nestjs/common';
import {
  ActivityKind,
  ActivityVisibility,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { WorkflowsService } from '../../workflows/workflows.service';
import {
  GenerateAgreementDraftDto,
  GenerateReminderDto,
  GenerateStatementSummaryDto,
} from '../contracts/ai.controller.contract';

@Injectable()
export class AiRevenueDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async generateReminder(input: GenerateReminderDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: { id: true, organizationId: true, legalName: true, displayName: true },
    });

    const clientName = client.displayName || client.legalName;

    const workflow = await this.workflows.createWorkflowRun({
      clientId: client.id,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.REMINDER_DISPATCH,
      status: WorkflowStatus.COMPLETED,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.AI_GENERATED,
      title: `Reminder draft for ${clientName}`,
      inputJson: {
        clientId: input.clientId,
        context: input.context,
      },
      contextJson: {
        initiatedBy: 'ai.controller',
        endpoint: 'POST /v1/ai/revenue/reminder/generate',
      },
      resultJson: { kind: 'REMINDER_DRAFT' },
      completedAt: new Date(),
    });

    const amountText =
      typeof input.context?.amount === 'number'
        ? `$${input.context.amount.toFixed(2)}`
        : 'the outstanding balance';

    const dueDateText = input.context?.dueDate ?? 'the due date on file';

    const subject = 'Friendly reminder regarding your invoice';
    const body = [
      'Hello,',
      '',
      `This is a reminder regarding invoice ${input.context?.invoiceId ?? ''}`.trim(),
      `Our records show ${amountText} is pending, with reference to ${dueDateText}.`,
      'Please review and arrange payment at your earliest convenience.',
      '',
      'Thank you.',
    ].join('\n');

    await this.prisma.activityEvent.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        workflowRunId: workflow.id,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'revenue_reminder',
        subjectId: workflow.id,
        summary: 'Reminder draft generated',
        metadataJson: {
          invoiceId: input.context?.invoiceId ?? null,
        },
      },
    });

    return {
      workflowRunId: workflow.id,
      kind: 'REMINDER_DRAFT',
      subject,
      body,
      context: input.context,
    };
  }

  async generateAgreementDraft(input: GenerateAgreementDraftDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: { id: true, organizationId: true, legalName: true, displayName: true },
    });

    const clientName = client.displayName || client.legalName;

    const workflow = await this.workflows.createWorkflowRun({
      clientId: client.id,
      lane: WorkflowLane.DOCUMENTS,
      type: WorkflowType.AGREEMENT_ISSUANCE,
      status: WorkflowStatus.COMPLETED,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.AI_GENERATED,
      title: `Agreement draft for ${clientName}`,
      inputJson: {
        clientId: input.clientId,
        context: input.context,
      },
      contextJson: {
        initiatedBy: 'ai.controller',
        endpoint: 'POST /v1/ai/revenue/agreement/generate-draft',
      },
      resultJson: { kind: 'AGREEMENT_DRAFT' },
      completedAt: new Date(),
    });

    const draft = [
      'Service Agreement Draft',
      '',
      `Client: ${clientName}`,
      `Service: ${input.context.service}`,
      '',
      'Scope',
      input.context.terms ??
        'The parties agree to the service scope and delivery boundaries as defined in the client profile and active service configuration.',
      '',
      'Performance',
      'Services will be delivered according to the active workflow, plan limits, and operational availability defined in Orchestrate.',
      '',
      'Commercial Terms',
      'Billing, invoices, receipts, reminders, and statements remain governed by the active subscription and issued financial records.',
    ].join('\n');

    await this.prisma.activityEvent.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        workflowRunId: workflow.id,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'agreement_draft',
        subjectId: workflow.id,
        summary: 'Agreement draft generated',
        metadataJson: {
          service: input.context.service,
        },
      },
    });

    return {
      workflowRunId: workflow.id,
      kind: 'AGREEMENT_DRAFT',
      title: `Agreement draft for ${input.context.service}`,
      body: draft,
      context: input.context,
    };
  }

  async generateStatementSummary(input: GenerateStatementSummaryDto) {
    const client = await this.prisma.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: { id: true, organizationId: true, legalName: true, displayName: true },
    });

    const clientName = client.displayName || client.legalName;

    const workflow = await this.workflows.createWorkflowRun({
      clientId: client.id,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.STATEMENT_ISSUANCE,
      status: WorkflowStatus.COMPLETED,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.AI_GENERATED,
      title: `Statement summary for ${clientName}`,
      inputJson: {
        clientId: input.clientId,
        context: input.context,
      },
      contextJson: {
        initiatedBy: 'ai.controller',
        endpoint: 'POST /v1/ai/revenue/statement/generate-summary',
      },
      resultJson: { kind: 'STATEMENT_SUMMARY' },
      completedAt: new Date(),
    });

    const summary = [
      'Statement Summary',
      '',
      `Client: ${clientName}`,
      `Period: ${input.context.period}`,
      '',
      'This summary reflects the financial activity recorded for the selected period, including issued invoices, posted payments, receipts, and any outstanding balances still open at statement close.',
      input.context.summaryData
        ? 'Additional reference data has been attached in structured form for review.'
        : 'No additional summary data was provided with this request.',
    ].join('\n');

    await this.prisma.activityEvent.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        workflowRunId: workflow.id,
        kind: ActivityKind.NOTE_ADDED,
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'statement_summary',
        subjectId: workflow.id,
        summary: 'Statement summary generated',
        metadataJson: {
          period: input.context.period,
        },
      },
    });

    return {
      workflowRunId: workflow.id,
      kind: 'STATEMENT_SUMMARY',
      title: `Statement summary for ${input.context.period}`,
      body: summary,
      context: input.context,
    };
  }
}
