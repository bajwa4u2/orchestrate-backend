import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ArtifactLifecycle,
  DispatchLifecycle,
  DocumentDispatchStatus,
  EmailCategory,
  EmailDeliveryMode,
  EmailDeliveryProvider,
  EmailEventType,
  InvoiceStatus,
  RecordSource,
  TemplateType,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
  Prisma,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { InvoiceDocumentBuilder } from './dto/invoice-document.builder';
import { InvoiceEmailRenderer } from './dto/invoice-email.renderer';
import { InvoicePdfService } from './invoice-pdf.service';

@Injectable()
export class InvoiceDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly invoiceDocumentBuilder: InvoiceDocumentBuilder,
    private readonly invoiceEmailRenderer: InvoiceEmailRenderer,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly emailsService: EmailsService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async sendInvoiceEmail(params: {
    invoiceId: string;
    actorUserId?: string;
    toEmail?: string;
    attachPdf?: boolean;
  }) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: params.invoiceId },
      include: {
        organization: {
          select: {
            id: true,
            displayName: true,
            currencyCode: true,
          },
        },
        client: {
          select: {
            id: true,
            displayName: true,
            legalName: true,
            primaryEmail: true,
            billingEmail: true,
            legalEmail: true,
            opsEmail: true,
            billingContactName: true,
            primaryContactName: true,
            metadataJson: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const recipient = this.resolveRecipient(invoice.client, params.toEmail);
    if (!recipient.email) {
      throw new BadRequestException('No billing recipient email was found for this invoice');
    }

    const workflow = invoice.workflowRunId
      ? await this.workflowsService.startWorkflowRun(invoice.workflowRunId, {
          stage: 'invoice-delivery',
          invoiceId: invoice.id,
        })
      : await this.workflowsService.createWorkflowRun({
          clientId: invoice.clientId,
          subscriptionId: invoice.subscriptionId ?? undefined,
          invoiceId: invoice.id,
          lane: WorkflowLane.DOCUMENTS,
          type: WorkflowType.DOCUMENT_DISPATCH,
          status: WorkflowStatus.RUNNING,
          trigger: params.actorUserId ? WorkflowTrigger.MANUAL_OPERATOR : WorkflowTrigger.SYSTEM_EVENT,
          source: RecordSource.SYSTEM_GENERATED,
          title: `Invoice dispatch ${invoice.invoiceNumber}`,
          startedAt: new Date(),
        });

    const workflowRunId = workflow.id;
    const normalizedInvoice = this.invoiceDocumentBuilder.buildFromRecord(invoice);
    const shouldAttachPdf = params.attachPdf !== false;
    const generatedPdf = shouldAttachPdf
      ? await this.invoicePdfService.generateAndPersistPdf(invoice.id)
      : null;

    const invoiceUrl = invoice.pdfFileUrl ?? null;
    const payUrl = invoice.pdfFileUrl ?? null;

    const emailPayload = this.invoiceEmailRenderer.render({
      invoice: normalizedInvoice,
      recipient,
      organization: invoice.organization,
      invoiceUrl,
      payUrl,
    });

    const transport = await this.emailsService.sendDirectEmail({
      subject: emailPayload.subject,
      bodyText: emailPayload.text,
      toEmail: recipient.email,
      toName: recipient.name ?? undefined,
      category: 'billing',
      emailEvent: 'invoice_issued',
      templateVariables: emailPayload.variables,
      attachments: generatedPdf
        ? [
            {
              filename: generatedPdf.filename,
              contentBase64: generatedPdf.pdfBase64,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });

    const now = new Date();
    const dispatchStatus =
      transport.mode === 'resend'
        ? DocumentDispatchStatus.SENT
        : DocumentDispatchStatus.ISSUED;

    const dispatch = await this.db.documentDispatch.create({
      data: {
        organizationId: invoice.organizationId,
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        workflowRunId,
        kind: TemplateType.INVOICE,
        emailCategory: EmailCategory.BILLING,
        emailEvent: EmailEventType.INVOICE_ISSUED,
        status: dispatchStatus,
        source: RecordSource.SYSTEM_GENERATED,
        dispatchState: transport.mode === 'resend' ? DispatchLifecycle.SENT : DispatchLifecycle.QUEUED,
        deliveryChannel: 'EMAIL',
        deliveryProvider: this.mapDeliveryProvider(transport.mode),
        deliveryMode: this.mapDeliveryMode(transport.mode),
        recipientEmail: recipient.email,
        recipientName: recipient.name ?? undefined,
        fromEmail: transport.from,
        replyToEmail: transport.replyTo ?? undefined,
        subjectLine: emailPayload.subject,
        bodyText: emailPayload.text,
        payloadJson: toPrismaJson({
          ...emailPayload.variables,
          attachment_filename: generatedPdf?.filename ?? null,
          attachment_included: Boolean(generatedPdf),
        }),
        transportMetadataJson: toPrismaJson({
          delivery_mode: transport.mode,
          external_message_id: transport.externalMessageId ?? null,
        }),
        externalMessageId: transport.externalMessageId,
        attemptCount: 1,
        lastAttemptAt: now,
        deliveredAt: transport.mode === 'resend' ? now : undefined,
      },
    });

    const nextStatus =
      transport.mode === 'disabled'
        ? invoice.status === InvoiceStatus.DRAFT
          ? InvoiceStatus.ISSUED
          : invoice.status
        : InvoiceStatus.SENT;

    const issuedAt = invoice.issuedAt ?? now;

    const updatedInvoice = await this.db.invoice.update({
      where: { id: invoice.id },
      data: {
        workflowRunId,
        source: RecordSource.SYSTEM_GENERATED,
        lifecycle: transport.mode === 'resend' ? ArtifactLifecycle.DISPATCHED : ArtifactLifecycle.ISSUED,
        status: nextStatus,
        issuedAt,
        lastSentAt: transport.mode === 'disabled' ? invoice.lastSentAt : now,
        pdfGeneratedAt: generatedPdf ? now : invoice.pdfGeneratedAt,
      },
    });

    await this.workflowsService.completeWorkflowRun(workflowRunId, {
      invoiceId: updatedInvoice.id,
      dispatchId: dispatch.id,
      invoiceNumber: updatedInvoice.invoiceNumber,
      dispatchState: dispatch.dispatchState,
      transportMode: transport.mode,
    });

    return {
      invoice: updatedInvoice,
      dispatch,
      transport,
    };
  }

  private resolveRecipient(
    client: {
      displayName: string;
      legalName: string;
      billingEmail: string | null;
      primaryEmail: string | null;
      legalEmail: string | null;
      opsEmail: string | null;
      billingContactName: string | null;
      primaryContactName: string | null;
      metadataJson: Prisma.JsonValue | null;
    },
    explicitEmail?: string,
  ) {
    const metadata = this.asObject(client.metadataJson);
    const metadataEmail = this.firstString(
      metadata.billingEmail,
      metadata.billing_email,
      metadata.email,
      metadata.primaryEmail,
    );

    const email = this.firstString(
      explicitEmail,
      client.billingEmail,
      client.primaryEmail,
      client.legalEmail,
      client.opsEmail,
      metadataEmail,
    );

    const name = this.firstString(
      client.billingContactName,
      client.primaryContactName,
      client.displayName,
      client.legalName,
    );

    return { email: email ?? '', name };
  }

  private firstString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private mapDeliveryMode(mode: 'resend' | 'log' | 'disabled') {
    switch (mode) {
      case 'resend':
        return EmailDeliveryMode.RESEND;
      case 'log':
        return EmailDeliveryMode.LOG;
      default:
        return EmailDeliveryMode.DISABLED;
    }
  }

  private mapDeliveryProvider(mode: 'resend' | 'log' | 'disabled') {
    switch (mode) {
      case 'resend':
        return EmailDeliveryProvider.RESEND;
      case 'log':
        return EmailDeliveryProvider.INTERNAL;
      default:
        return EmailDeliveryProvider.MANUAL;
    }
  }
}
