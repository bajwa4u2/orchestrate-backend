import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AgreementStatus,
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
import { formatDate } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { AgreementDocumentBuilder } from './dto/agreement-document.builder';
import { AgreementHtmlRenderer } from './dto/agreement-html.renderer';

@Injectable()
export class AgreementDeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly emailsService: EmailsService,
    private readonly workflowsService: WorkflowsService,
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

    const agreement = await this.db.serviceAgreement.findUnique({
      where: { id: agreementId },
      select: {
        id: true,
        workflowRunId: true,
        subscriptionId: true,
      },
    });

    if (!agreement) throw new NotFoundException('Agreement not found');

    const workflow = agreement.workflowRunId
      ? await this.workflowsService.startWorkflowRun(agreement.workflowRunId, {
          stage: 'agreement-delivery',
          agreementId: document.id,
        })
      : await this.workflowsService.createWorkflowRun({
          clientId: document.clientId,
          subscriptionId: agreement.subscriptionId ?? undefined,
          serviceAgreementId: document.id,
          lane: WorkflowLane.DOCUMENTS,
          type: WorkflowType.DOCUMENT_DISPATCH,
          status: WorkflowStatus.RUNNING,
          trigger: WorkflowTrigger.SYSTEM_EVENT,
          source: RecordSource.SYSTEM_GENERATED,
          title: `Agreement dispatch ${document.agreementNumber}`,
          startedAt: new Date(),
        });
    const workflowRunId = workflow.id;

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
        workflowRunId,
        source: RecordSource.SYSTEM_GENERATED,
        lifecycle: transport.mode === 'resend' ? ArtifactLifecycle.DISPATCHED : ArtifactLifecycle.ISSUED,
        status: document.status === AgreementStatus.DRAFT ? AgreementStatus.ISSUED : undefined,
      },
    });

    const dispatch = await this.db.documentDispatch.create({
      data: {
        organizationId: document.organizationId,
        clientId: document.clientId,
        agreementId: document.id,
        workflowRunId,
        kind: TemplateType.AGREEMENT,
        emailCategory: EmailCategory.LEGAL,
        emailEvent: EmailEventType.AGREEMENT_SENT,
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
        payloadJson: toPrismaJson({ agreementNumber: document.agreementNumber, title: document.title }),
        transportMetadataJson: toPrismaJson({ mode: transport.mode, externalMessageId: transport.externalMessageId ?? null }),
        externalMessageId: transport.externalMessageId,
        attemptCount: 1,
        lastAttemptAt: now,
        deliveredAt: transport.mode === 'resend' ? now : undefined,
      },
    });

    await this.workflowsService.completeWorkflowRun(workflowRunId, {
      agreementId: document.id,
      dispatchId: dispatch.id,
      agreementNumber: document.agreementNumber,
      transportMode: transport.mode,
    });

    return { document, dispatch, transport };
  }
}
