import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentDispatchStatus, EmailCategory, EmailDeliveryMode, EmailDeliveryProvider, EmailEventType, TemplateType } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { formatDate, formatMoney } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { StatementDocumentBuilder } from './dto/statement-document.builder';
import { StatementHtmlRenderer } from './dto/statement-html.renderer';

@Injectable()
export class StatementDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailsService: EmailsService,
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
        kind: TemplateType.STATEMENT,
        emailCategory: EmailCategory.BILLING,
        emailEvent: EmailEventType.STATEMENT_ISSUED,
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
        payloadJson: toPrismaJson({ statementNumber: document.statementNumber, label: document.label }),
        transportMetadataJson: toPrismaJson({ mode: transport.mode, externalMessageId: transport.externalMessageId ?? null }),
        externalMessageId: transport.externalMessageId,
        attemptCount: 1,
        lastAttemptAt: now,
        deliveredAt: transport.mode === 'resend' ? now : undefined,
      },
    });

    await this.db.statement.update({ where: { id: document.id }, data: { issuedAt: now, status: 'ISSUED' } });

    return { document, dispatch, transport };
  }
}
