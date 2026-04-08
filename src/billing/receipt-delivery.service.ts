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
import { formatDateTime, formatMoney } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { ReceiptDocumentBuilder } from './dto/receipt-document.builder';
import { ReceiptHtmlRenderer } from './dto/receipt-html.renderer';

@Injectable()
export class ReceiptDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailsService: EmailsService,
    private readonly workflowsService: WorkflowsService,
    private readonly builder: ReceiptDocumentBuilder,
    private readonly renderer: ReceiptHtmlRenderer,
  ) {}

  async renderReceipt(receiptId: string) {
    const document = await this.builder.buildByReceiptId(receiptId);
    return {
      document,
      html: this.renderer.render(document),
    };
  }

  async sendReceiptEmail(receiptId: string) {
    const document = await this.builder.buildByReceiptId(receiptId);
    if (!document.clientEmail) {
      throw new NotFoundException('No billing recipient found for receipt');
    }

    const receipt = await this.db.receipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        workflowRunId: true,
        invoiceId: true,
      },
    });

    if (!receipt) {
      throw new NotFoundException('Receipt not found');
    }

    const workflow = receipt.workflowRunId
      ? await this.workflowsService.startWorkflowRun(receipt.workflowRunId, {
          stage: 'receipt-delivery',
          receiptId: document.id,
        })
      : await this.workflowsService.createWorkflowRun({
          clientId: document.clientId,
          invoiceId: receipt.invoiceId ?? undefined,
          lane: WorkflowLane.DOCUMENTS,
          type: WorkflowType.DOCUMENT_DISPATCH,
          status: WorkflowStatus.RUNNING,
          trigger: WorkflowTrigger.SYSTEM_EVENT,
          source: RecordSource.SYSTEM_GENERATED,
          title: `Receipt dispatch ${document.receiptNumber}`,
          startedAt: new Date(),
        });
    const workflowRunId = workflow.id;

    const html = this.renderer.render(document);
    const subject = `Payment receipt ${document.receiptNumber}`;
    const bodyText = [
      'Payment received. Thank you.',
      `Receipt number: ${document.receiptNumber}`,
      `Amount: ${formatMoney(document.amountCents, document.currencyCode)}`,
      document.invoiceNumber ? `Invoice: ${document.invoiceNumber}` : null,
      `Received: ${formatDateTime(document.paymentReceivedAt ?? document.issuedAt)}`,
      ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
    ].filter(Boolean).join('\n\n');

    const transport = await this.emailsService.sendDirectEmail({
      emailEvent: 'payment_received',
      category: 'billing',
      toEmail: document.clientEmail,
      toName: document.clientName,
      subject,
      bodyText,
      bodyHtml: html,
    });

    const now = new Date();
    await this.db.receipt.update({
      where: { id: document.id },
      data: {
        workflowRunId,
        source: RecordSource.SYSTEM_GENERATED,
        lifecycle: transport.mode === 'resend' ? ArtifactLifecycle.DISPATCHED : ArtifactLifecycle.ISSUED,
      },
    });

    const dispatch = await this.db.documentDispatch.create({
      data: {
        organizationId: document.organizationId,
        clientId: document.clientId,
        receiptId: document.id,
        workflowRunId,
        kind: TemplateType.RECEIPT,
        emailCategory: EmailCategory.BILLING,
        emailEvent: EmailEventType.PAYMENT_RECEIVED,
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
        payloadJson: toPrismaJson({ receiptNumber: document.receiptNumber, invoiceNumber: document.invoiceNumber }),
        transportMetadataJson: toPrismaJson({ mode: transport.mode, externalMessageId: transport.externalMessageId ?? null }),
        externalMessageId: transport.externalMessageId,
        attemptCount: 1,
        lastAttemptAt: now,
        deliveredAt: transport.mode === 'resend' ? now : undefined,
      },
    });

    await this.workflowsService.completeWorkflowRun(workflowRunId, {
      receiptId: document.id,
      dispatchId: dispatch.id,
      receiptNumber: document.receiptNumber,
      transportMode: transport.mode,
    });

    return { document, dispatch, transport };
  }
}
