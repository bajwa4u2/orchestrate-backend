import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ArtifactLifecycle,
  DispatchLifecycle,
  DocumentDispatchStatus,
  EmailCategory,
  EmailDeliveryMode,
  EmailDeliveryProvider,
  EmailEventType,
  RecordSource,
  TemplateType,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { formatDate, formatMoney } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { StatementDocumentBuilder } from './dto/statement-document.builder';
import { StatementHtmlRenderer } from './dto/statement-html.renderer';

@Injectable()
export class StatementDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailsService: EmailsService,
    private readonly workflowsService: WorkflowsService,
    private readonly builder: StatementDocumentBuilder,
    private readonly renderer: StatementHtmlRenderer,
  ) {}

  async renderStatement(statementId: string) {
    const document = await this.builder.buildByStatementId(statementId);
    return { document, html: this.renderer.render(document) };
  }

  async sendStatementEmail(statementId: string) {
    const document = await this.builder.buildByStatementId(statementId);
    if (!document.clientEmail) throw new NotFoundException('No statement recipient email found');

    const statement = await this.db.statement.findUnique({
      where: { id: statementId },
      select: {
        id: true,
        workflowRunId: true,
      },
    });

    if (!statement) throw new NotFoundException('Statement not found');

    const workflow = statement.workflowRunId
      ? await this.workflowsService.startWorkflowRun(statement.workflowRunId, {
          stage: 'statement-delivery',
          statementId: document.id,
        })
      : await this.workflowsService.createWorkflowRun({
          clientId: document.clientId,
          statementId: document.id,
          lane: WorkflowLane.DOCUMENTS,
          type: WorkflowType.DOCUMENT_DISPATCH,
          status: WorkflowStatus.RUNNING,
          trigger: WorkflowTrigger.SYSTEM_EVENT,
          source: RecordSource.SYSTEM_GENERATED,
          title: `Statement dispatch ${document.statementNumber}`,
          startedAt: new Date(),
        });
    const workflowRunId = workflow.id;

    const html = this.renderer.render(document);
    const subject = `Statement ${document.statementNumber} is ready`;
    const bodyText = [
      `Your statement ${document.statementNumber} is ready.`,
      `Period: ${formatDate(document.periodStart)} to ${formatDate(document.periodEnd)}.`,
      `Closing balance: ${formatMoney(document.closingBalanceCents, document.currencyCode)}.`,
      ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
    ].join('\n\n');

    const transport = await this.emailsService.sendDirectEmail({
      emailEvent: 'statement_issued',
      category: 'billing',
      toEmail: document.clientEmail,
      toName: document.clientName,
      subject,
      bodyText,
      bodyHtml: html,
    });

    const now = new Date();
    const dispatch = await this.db.documentDispatch.create({
      data: {
        organizationId: document.organizationId,
        clientId: document.clientId,
        statementId: document.id,
        workflowRunId,
        kind: TemplateType.STATEMENT,
        emailCategory: EmailCategory.BILLING,
        emailEvent: EmailEventType.STATEMENT_ISSUED,
        status: transport.mode === 'resend' ? DocumentDispatchStatus.SENT : DocumentDispatchStatus.ISSUED,
        source: RecordSource.SYSTEM_GENERATED,
        dispatchState: transport.mode === 'resend' ? DispatchLifecycle.SENT : DispatchLifecycle.QUEUED,
        deliveryChannel: 'EMAIL',
        deliveryProvider:
          transport.mode === 'resend'
            ? EmailDeliveryProvider.RESEND
            : transport.mode === 'log'
              ? EmailDeliveryProvider.INTERNAL
              : EmailDeliveryProvider.MANUAL,
        deliveryMode:
          transport.mode === 'resend'
            ? EmailDeliveryMode.RESEND
            : transport.mode === 'log'
              ? EmailDeliveryMode.LOG
              : EmailDeliveryMode.DISABLED,
        recipientEmail: document.clientEmail,
        recipientName: document.clientName,
        fromEmail: transport.from,
        replyToEmail: transport.replyTo,
        subjectLine: subject,
        bodyText,
        payloadJson: toPrismaJson({ statementNumber: document.statementNumber, label: document.label }),
        transportMetadataJson: toPrismaJson({ mode: transport.mode, externalMessageId: transport.externalMessageId ?? null }),
        externalMessageId: transport.externalMessageId,
        attemptCount: 1,
        lastAttemptAt: now,
        deliveredAt: transport.mode === 'resend' ? now : undefined,
      },
    });

    await this.db.statement.update({
      where: { id: document.id },
      data: {
        workflowRunId,
        source: RecordSource.SYSTEM_GENERATED,
        lifecycle: transport.mode === 'resend' ? ArtifactLifecycle.DISPATCHED : ArtifactLifecycle.ISSUED,
        issuedAt: now,
        status: 'ISSUED',
      },
    });

    await this.workflowsService.completeWorkflowRun(workflowRunId, {
      statementId: document.id,
      dispatchId: dispatch.id,
      statementNumber: document.statementNumber,
      transportMode: transport.mode,
    });

    return { document, dispatch, transport };
  }
}
