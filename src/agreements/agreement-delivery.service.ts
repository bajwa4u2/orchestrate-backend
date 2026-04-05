import { Injectable, NotFoundException } from '@nestjs/common';
import { AgreementStatus, DocumentDispatchStatus, EmailCategory, EmailDeliveryMode, EmailDeliveryProvider, EmailEventType, TemplateType } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { formatDate } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { AgreementDocumentBuilder } from './dto/agreement-document.builder';
import { AgreementHtmlRenderer } from './dto/agreement-html.renderer';

@Injectable()
export class AgreementDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailsService: EmailsService,
    private readonly builder: AgreementDocumentBuilder,
    private readonly renderer: AgreementHtmlRenderer,
  ) {}

  async renderAgreement(agreementId: string) {
    const document = await this.builder.buildByAgreementId(agreementId);
    return { document, html: this.renderer.render(document) };
  }

  async sendAgreementEmail(agreementId: string) {
    const document = await this.builder.buildByAgreementId(agreementId);
    if (!document.clientEmail) throw new NotFoundException('No agreement recipient email found');

    const html = this.renderer.render(document);
    const subject = `${document.title || 'Orchestrate Service Agreement'} ${document.agreementNumber}`;
    const bodyText = [
      'Your Orchestrate service agreement is ready.',
      `Agreement number: ${document.agreementNumber}`,
      `Contracting party: ${ORCHESTRATE_LEGAL_IDENTITY.legalEntityName}`,
      `Effective start: ${formatDate(document.effectiveStartAt)}`,
      ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
    ].join('\n\n');

    const transport = await this.emailsService.sendDirectEmail({
      emailEvent: 'agreement_sent',
      category: 'legal',
      toEmail: document.clientEmail,
      toName: document.clientName,
      subject,
      bodyText,
      bodyHtml: html,
    });

    const now = new Date();
    await this.db.serviceAgreement.update({
      where: { id: document.id },
      data: {
        status: document.status === AgreementStatus.DRAFT ? AgreementStatus.ISSUED : undefined,
      },
    });

    const dispatch = await this.db.documentDispatch.create({
      data: {
        organizationId: document.organizationId,
        clientId: document.clientId,
        agreementId: document.id,
        kind: TemplateType.AGREEMENT,
        emailCategory: EmailCategory.LEGAL,
        emailEvent: EmailEventType.AGREEMENT_SENT,
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
        payloadJson: toPrismaJson({ agreementNumber: document.agreementNumber, title: document.title }),
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
