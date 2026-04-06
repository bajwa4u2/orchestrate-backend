import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentDispatchStatus, EmailCategory, EmailDeliveryMode, EmailDeliveryProvider, EmailEventType, TemplateType } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { formatDateTime, formatMoney } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { ReceiptDocumentBuilder } from './dto/receipt-document.builder';
import { ReceiptHtmlRenderer } from './dto/receipt-html.renderer';

@Injectable()
export class ReceiptDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailsService: EmailsService,
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
    const dispatch = await this.db.documentDispatch.create({
      data: {
        organizationId: document.organizationId,
        clientId: document.clientId,
        receiptId: document.id,
        kind: TemplateType.RECEIPT,
        emailCategory: EmailCategory.BILLING,
        emailEvent: EmailEventType.PAYMENT_RECEIVED,
        status: transport.mode === 'resend' ? DocumentDispatchStatus.SENT : DocumentDispatchStatus.ISSUED,
        deliveryChannel: 'EMAIL',
        deliveryProvider: transport.mode === 'resend' ? EmailDeliveryProvider.RESEND : transport.mode === 'log' ? EmailDeliveryProvider.INTERNAL : EmailDeliveryProvider.MANUAL,
        deliveryMode: transport.mode === 'resend' ? EmailDeliveryMode.RESEND : transport.mode === 'log' ? EmailDeliveryMode.LOG : EmailDeliveryMode.DISABLED,
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

    return { document, dispatch, transport };
  }
}
