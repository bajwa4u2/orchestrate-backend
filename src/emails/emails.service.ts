import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DocumentDispatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SendTemplatedEmailDto } from './dto/send-templated-email.dto';

import { accountApprovedTemplate } from './templates/account-approved.template';
import { accountEmailVerificationTemplate } from './templates/account-email-verification.template';
import { accountOnHoldTemplate } from './templates/account-on-hold.template';
import { accountPasswordResetTemplate } from './templates/account-password-reset.template';
import { accountSecurityAlertTemplate } from './templates/account-security-alert.template';
import { accountWelcomeTemplate } from './templates/account-welcome.template';
import { agreementRevisionSentTemplate } from './templates/agreement-revision-sent.template';
import { agreementSentTemplate } from './templates/agreement-sent.template';
import { agreementSignedTemplate } from './templates/agreement-signed.template';
import { campaignStartedTemplate } from './templates/campaign-started.template';
import { clientOnboardingCompletedTemplate } from './templates/client-onboarding-completed.template';
import { clientOnboardingStartedTemplate } from './templates/client-onboarding-started.template';
import { complianceRequestSentTemplate } from './templates/compliance-request-sent.template';
import { formalNoticeSentTemplate } from './templates/formal-notice-sent.template';
import { invoiceIssuedTemplate } from './templates/invoice-issued.template';
import { invoiceReminderDueTemplate } from './templates/invoice-reminder-due.template';
import { invoiceReminderOverdueTemplate } from './templates/invoice-reminder-overdue.template';
import { leadDeliveryAvailableTemplate } from './templates/lead-delivery-available.template';
import { meetingBookedNoticeTemplate } from './templates/meeting-booked-notice.template';
import { paymentFailedTemplate } from './templates/payment-failed.template';
import { paymentReceivedTemplate } from './templates/payment-received.template';
import { privacyUpdatedTemplate } from './templates/privacy-updated.template';
import { refundIssuedTemplate } from './templates/refund-issued.template';
import { serviceIssueNoticeTemplate } from './templates/service-issue-notice.template';
import { setupCompletionReminderTemplate } from './templates/setup-completion-reminder.template';
import { statementIssuedTemplate } from './templates/statement-issued.template';
import { subscriptionCanceledTemplate } from './templates/subscription-canceled.template';
import { subscriptionCreatedTemplate } from './templates/subscription-created.template';
import { subscriptionRenewedTemplate } from './templates/subscription-renewed.template';
import { termsUpdatedTemplate } from './templates/terms-updated.template';

type EmailCategory = 'support' | 'billing' | 'legal' | 'hello' | 'no-reply';

type EmailEvent =
  | 'account_welcome'
  | 'account_email_verification'
  | 'account_password_reset'
  | 'account_security_notice'
  | 'account_approved'
  | 'account_on_hold'
  | 'contact_acknowledgement'
  | 'demo_acknowledgement'
  | 'newsletter_confirmation'
  | 'subscription_created'
  | 'subscription_renewed'
  | 'subscription_canceled'
  | 'invoice_issued'
  | 'invoice_payment_due_reminder'
  | 'invoice_payment_overdue_reminder'
  | 'payment_received'
  | 'payment_failed'
  | 'refund_issued'
  | 'statement_issued'
  | 'statement_ready_reminder'
  | 'agreement_sent'
  | 'agreement_signature_request'
  | 'agreement_signed'
  | 'agreement_revision_sent'
  | 'terms_update_notice'
  | 'privacy_update_notice'
  | 'compliance_request'
  | 'formal_legal_notice'
  | 'client_onboarding_started'
  | 'client_onboarding_completed'
  | 'campaign_launched'
  | 'lead_delivery_notice'
  | 'meeting_booked_notice'
  | 'service_issue_alert'
  | 'service_setup_reminder'
  | 'system_status_notice'
  | 'secure_action_link'
  | 'secure_action_link_expiring';

type EmailProfile = {
  category: EmailCategory;
  from: string;
  replyTo?: string;
};

type TransportResult = {
  mode: 'resend' | 'log' | 'disabled';
  externalMessageId?: string;
  from: string;
  replyTo?: string;
};

type DirectEmailAttachment = {
  filename: string;
  contentBase64: string;
  contentType?: string;
};

type DirectEmailInput = {
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  toEmail: string;
  toName?: string;
  category?: EmailCategory;
  emailEvent?: EmailEvent;
  replyToEmail?: string;
  templateVariables?: Record<string, unknown>;
  attachments?: DirectEmailAttachment[];
};

type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  listDispatches(organizationId: string, clientId?: string) {
    return this.prisma.documentDispatch.findMany({
      where: { organizationId, deliveryChannel: 'EMAIL', ...(clientId ? { clientId } : {}) },
      include: {
        client: true,
        template: true,
        invoice: true,
        statement: true,
        agreement: true,
        receipt: true,
        reminder: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async resolveClientRecipient(organizationId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: {
        id: true,
        displayName: true,
        legalName: true,
        metadataJson: true,
      },
    });

    if (!client) return null;

    return {
      clientId: client.id,
      name: client.displayName || client.legalName || 'Client',
      email: this.extractEmailAddress(client.metadataJson),
    };
  }

  async sendTemplateEmail(organizationId: string, actorUserId: string | undefined, dto: SendTemplatedEmailDto) {
    const template = await this.prisma.template.findFirst({
      where: { id: dto.templateId, organizationId, isActive: true },
    });
    if (!template) throw new NotFoundException('Template not found in active organization');

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, displayName: true },
    });

    const client = dto.clientId
      ? await this.prisma.client.findFirst({
          where: { id: dto.clientId, organizationId },
          select: { id: true, displayName: true, legalName: true },
        })
      : null;

    const recipientEmail = dto.toEmail ?? this.resolveEmailFromVariables(dto.variables);
    if (!recipientEmail) {
      throw new BadRequestException('Missing recipient email. Provide toEmail or include email in variables.');
    }

    const baseUrl = this.getBaseUrl();
    const portalUrl = this.getClientPortalUrl(client?.id);
    const variables = {
      ...(dto.variables ?? {}),
      app_url: baseUrl,
      portal_url: portalUrl,
      organization_name: organization?.displayName ?? this.getBrandName(),
      client_name: client?.displayName ?? client?.legalName ?? dto.toName ?? 'Client',
      support_email: process.env.EMAIL_REPLY_TO_SUPPORT?.trim() || 'support@orchestrateops.com',
      legal_name: 'Aura Platform LLC',
      legal_line: 'Orchestrate is a product of Aura Platform LLC.',
    };

    const renderedSubject = this.renderString(template.subjectTemplate, variables) ?? template.name;
    const renderedBody = this.renderString(template.bodyTemplate, variables) ?? '';
    const emailEvent = this.resolveEvent({
      explicitEvent: (dto as any).emailEvent,
      explicitCategory: (dto as any).emailCategory,
      templateType: template.type == null ? undefined : String(template.type),
      templateName: template.name,
      subject: renderedSubject,
      body: renderedBody,
    });
    const category = this.resolveEventCategory(emailEvent);
    const profile = this.resolveProfile(category, (dto as any).replyToEmail);

    const eventRendered = this.renderEventEmail(emailEvent, {
      ...variables,
      toName: dto.toName,
      recipient_name: dto.toName,
      recipient_email: recipientEmail,
    });

    const transport = await this.deliverEmail({
      subject: eventRendered?.subject ?? renderedSubject,
      bodyText: eventRendered?.text ?? renderedBody,
      bodyHtml: eventRendered?.html,
      toEmail: recipientEmail,
      toName: dto.toName,
      category,
      emailEvent,
      replyToEmail: (dto as any).replyToEmail,
      templateVariables: variables,
    });

    const dispatch = await this.prisma.documentDispatch.create({
      data: {
        organizationId,
        clientId: client?.id,
        templateId: template.id,
        kind: template.type,
        status: transport.mode === 'resend' ? DocumentDispatchStatus.SENT : DocumentDispatchStatus.ISSUED,
        deliveryChannel: 'EMAIL',
        recipientEmail,
        recipientName: dto.toName,
        subjectLine: eventRendered?.subject ?? renderedSubject,
        bodyText: eventRendered?.text ?? renderedBody,
        payloadJson: {
          ...variables,
          email_event: emailEvent,
          email_category: category,
          from_email: profile.from,
          reply_to_email: profile.replyTo ?? null,
          delivery_mode: transport.mode,
        } as Prisma.InputJsonValue,
        deliveredAt: transport.mode === 'resend' ? new Date() : undefined,
        externalMessageId: transport.externalMessageId,
      },
    });

    if ((dto as any).createNotification !== false) {
      await this.notificationsService.recordDocumentNotification({
        organizationId,
        clientId: client?.id,
        actorUserId,
        category: 'email',
        title: eventRendered?.subject ?? renderedSubject,
        bodyText:
          transport.mode === 'resend'
            ? `Email sent to ${recipientEmail} from ${profile.from}`
            : `Email prepared for ${recipientEmail}. Delivery mode is ${transport.mode}.`,
        metadataJson: {
          documentDispatchId: dispatch.id,
          templateId: template.id,
          recipientEmail,
          portalUrl,
          emailEvent,
          emailCategory: category,
          fromEmail: profile.from,
          replyToEmail: profile.replyTo ?? null,
          transportMode: transport.mode,
        } as Prisma.InputJsonValue,
      });
    }

    return {
      dispatch,
      transport: {
        mode: transport.mode,
        domain: this.getBaseUrl(),
        from: profile.from,
        replyTo: profile.replyTo ?? null,
        externalMessageId: transport.externalMessageId ?? null,
        event: emailEvent,
        category,
      },
    };
  }

  async sendDirectEmail(input: DirectEmailInput) {
    if (!input.toEmail?.trim()) throw new BadRequestException('Missing recipient email.');
    if (!input.subject?.trim() && !input.emailEvent) throw new BadRequestException('Missing subject.');
    if (!input.bodyText?.trim() && !input.bodyHtml?.trim() && !input.emailEvent) {
      throw new BadRequestException('Missing email body.');
    }

    const emailEvent = this.resolveEvent({
      explicitEvent: input.emailEvent,
      explicitCategory: input.category,
      subject: input.subject,
      body: input.bodyText || input.bodyHtml,
    });

    const eventRendered = this.renderEventEmail(emailEvent, {
      ...(input.templateVariables ?? {}),
      toName: input.toName,
      recipient_name: input.toName,
      recipient_email: input.toEmail,
    });

    return this.deliverEmail({
      subject: eventRendered?.subject ?? input.subject.trim(),
      bodyText: eventRendered?.text ?? (input.bodyText?.trim() || ''),
      bodyHtml: eventRendered?.html ?? input.bodyHtml?.trim(),
      toEmail: input.toEmail.trim(),
      toName: input.toName?.trim(),
      category: this.resolveEventCategory(emailEvent),
      emailEvent,
      replyToEmail: input.replyToEmail?.trim(),
      templateVariables: input.templateVariables,
    });
  }

  private async deliverEmail(input: DirectEmailInput): Promise<TransportResult> {
    const emailEvent = this.resolveEvent({
      explicitEvent: input.emailEvent,
      explicitCategory: input.category,
      subject: input.subject,
      body: input.bodyText || input.bodyHtml,
    });
    const profile = this.resolveProfile(this.resolveEventCategory(emailEvent), input.replyToEmail);
    const mode = this.resolveDeliveryMode();

    if (mode === 'disabled') {
      return { mode, from: profile.from, replyTo: profile.replyTo };
    }

    if (mode === 'log') {
      console.log('[emails] Prepared email', {
        to: this.formatRecipient(input.toEmail, input.toName),
        subject: input.subject,
        from: profile.from,
        replyTo: profile.replyTo,
        event: emailEvent,
        category: profile.category,
        attachments: input.attachments?.map((attachment) => attachment.filename) ?? [],
      });

      return { mode, from: profile.from, replyTo: profile.replyTo };
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new InternalServerErrorException('RESEND_API_KEY is missing.');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: profile.from,
        to: [this.formatRecipient(input.toEmail, input.toName)],
        reply_to: profile.replyTo ? [profile.replyTo] : undefined,
        subject: input.subject,
        text: input.bodyText || this.stripHtml(input.bodyHtml ?? ''),
        html: input.bodyHtml ?? this.textToHtml(input.bodyText),
        attachments: input.attachments?.length
          ? input.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.contentBase64,
              content_type: attachment.contentType,
            }))
          : undefined,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string; error?: unknown };

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Resend delivery failed${payload?.message ? `: ${payload.message}` : '.'}`,
      );
    }

    return {
      mode,
      from: profile.from,
      replyTo: profile.replyTo,
      externalMessageId: payload?.id,
    };
  }

  private renderEventEmail(event: EmailEvent, variables: Record<string, unknown>): RenderedEmail | null {
    const v = variables as Record<string, any>;
    const subject = this.defaultSubjectForEvent(event, v);

    switch (event) {
      case 'account_welcome':
        return this.toRendered(subject, accountWelcomeTemplate({ name: v.name ?? v.client_name ?? v.toName }));

      case 'account_email_verification':
      case 'secure_action_link':
        return this.toRendered(
          subject,
          accountEmailVerificationTemplate({ verifyUrl: v.verifyUrl ?? v.verify_url ?? v.actionUrl ?? v.action_url ?? v.app_url }),
        );

      case 'account_password_reset':
      case 'secure_action_link_expiring':
        return this.toRendered(
          subject,
          accountPasswordResetTemplate({ resetUrl: v.resetUrl ?? v.reset_url ?? v.actionUrl ?? v.action_url ?? v.app_url }),
        );

      case 'account_security_notice':
      case 'system_status_notice':
        return this.toRendered(
          subject,
          accountSecurityAlertTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            action: v.action,
            occurredAt: v.occurredAt ?? v.occurred_at,
            locationOrIp: v.locationOrIp ?? v.location_or_ip ?? v.ip,
            reviewUrl: v.reviewUrl ?? v.review_url ?? v.actionUrl ?? v.action_url,
          }),
        );

      case 'account_approved':
        return this.toRendered(
          subject,
          accountApprovedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            dashboardUrl: v.dashboardUrl ?? v.dashboard_url ?? v.portal_url ?? v.app_url,
          }),
        );

      case 'account_on_hold':
        return this.toRendered(
          subject,
          accountOnHoldTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            reason: v.reason,
            actionLabel: v.actionLabel ?? v.action_label,
            actionUrl: v.actionUrl ?? v.action_url,
          }),
        );

      case 'subscription_created':
        return this.toRendered(
          subject,
          subscriptionCreatedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            planName: v.planName ?? v.plan_name,
            amountLabel: v.amountLabel ?? v.amount_label ?? v.amount,
            billingInterval: v.billingInterval ?? v.billing_interval,
            startDate: v.startDate ?? v.start_date,
            dashboardUrl: v.dashboardUrl ?? v.dashboard_url ?? v.portal_url,
          }),
        );

      case 'invoice_issued':
        return this.toRendered(
          subject,
          invoiceIssuedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            invoiceNumber: v.invoiceNumber ?? v.invoice_number,
            issueDate: v.issueDate ?? v.issue_date,
            dueDate: v.dueDate ?? v.due_date,
            amountDue: v.amountDue ?? v.amount_due,
            servicePeriod: v.servicePeriod ?? v.service_period,
            invoiceUrl: v.invoiceUrl ?? v.invoice_url,
            payUrl: v.payUrl ?? v.pay_url,
          }),
        );

      case 'invoice_payment_due_reminder':
        return this.toRendered(
          subject,
          invoiceReminderDueTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            invoiceNumber: v.invoiceNumber ?? v.invoice_number,
            dueDate: v.dueDate ?? v.due_date,
            amountDue: v.amountDue ?? v.amount_due,
            payUrl: v.payUrl ?? v.pay_url,
            invoiceUrl: v.invoiceUrl ?? v.invoice_url,
          }),
        );

      case 'invoice_payment_overdue_reminder':
        return this.toRendered(
          subject,
          invoiceReminderOverdueTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            invoiceNumber: v.invoiceNumber ?? v.invoice_number,
            dueDate: v.dueDate ?? v.due_date,
            amountDue: v.amountDue ?? v.amount_due,
            payUrl: v.payUrl ?? v.pay_url,
            invoiceUrl: v.invoiceUrl ?? v.invoice_url,
          }),
        );

      case 'payment_received':
        return this.toRendered(
          subject,
          paymentReceivedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            receiptNumber: v.receiptNumber ?? v.receipt_number,
            invoiceNumber: v.invoiceNumber ?? v.invoice_number,
            paymentDate: v.paymentDate ?? v.payment_date,
            amountReceived: v.amountReceived ?? v.amount_received,
            receiptUrl: v.receiptUrl ?? v.receipt_url,
            remainingBalance: v.remainingBalance ?? v.remaining_balance,
          }),
        );

      case 'payment_failed':
        return this.toRendered(
          subject,
          paymentFailedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            invoiceNumber: v.invoiceNumber ?? v.invoice_number,
            amountDue: v.amountDue ?? v.amount_due,
            attemptedAt: v.attemptedAt ?? v.attempted_at,
            updatePaymentUrl: v.updatePaymentUrl ?? v.update_payment_url,
            invoiceUrl: v.invoiceUrl ?? v.invoice_url,
          }),
        );

      case 'refund_issued':
        return this.toRendered(
          subject,
          refundIssuedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            refundAmount: v.refundAmount ?? v.refund_amount,
            refundDate: v.refundDate ?? v.refund_date,
            invoiceNumber: v.invoiceNumber ?? v.invoice_number,
            receiptNumber: v.receiptNumber ?? v.receipt_number,
            refundReference: v.refundReference ?? v.refund_reference,
            billingUrl: v.billingUrl ?? v.billing_url ?? v.portal_url,
          }),
        );

      case 'subscription_renewed':
        return this.toRendered(
          subject,
          subscriptionRenewedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            planName: v.planName ?? v.plan_name,
            renewalDate: v.renewalDate ?? v.renewal_date,
            amountLabel: v.amountLabel ?? v.amount_label ?? v.amount,
            billingInterval: v.billingInterval ?? v.billing_interval,
            billingUrl: v.billingUrl ?? v.billing_url ?? v.portal_url,
          }),
        );

      case 'subscription_canceled':
        return this.toRendered(
          subject,
          subscriptionCanceledTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            planName: v.planName ?? v.plan_name,
            effectiveDate: v.effectiveDate ?? v.effective_date,
            accessEndsOn: v.accessEndsOn ?? v.access_ends_on,
            billingUrl: v.billingUrl ?? v.billing_url ?? v.portal_url,
          }),
        );

      case 'statement_issued':
      case 'statement_ready_reminder':
        return this.toRendered(
          subject,
          statementIssuedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            statementLabel: v.statementLabel ?? v.statement_label,
            periodLabel: v.periodLabel ?? v.period_label,
            issuedDate: v.issuedDate ?? v.issued_date,
            totalInvoiced: v.totalInvoiced ?? v.total_invoiced,
            totalPaid: v.totalPaid ?? v.total_paid,
            outstandingBalance: v.outstandingBalance ?? v.outstanding_balance,
            statementUrl: v.statementUrl ?? v.statement_url,
          }),
        );

      case 'agreement_sent':
      case 'agreement_signature_request':
        return this.toRendered(
          subject,
          agreementSentTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            agreementTitle: v.agreementTitle ?? v.agreement_title,
            agreementReference: v.agreementReference ?? v.agreement_reference,
            issueDate: v.issueDate ?? v.issue_date,
            effectiveDate: v.effectiveDate ?? v.effective_date,
            reviewUrl: v.reviewUrl ?? v.review_url,
            signUrl: v.signUrl ?? v.sign_url,
          }),
        );

      case 'agreement_signed':
        return this.toRendered(
          subject,
          agreementSignedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            agreementTitle: v.agreementTitle ?? v.agreement_title,
            agreementReference: v.agreementReference ?? v.agreement_reference,
            signedDate: v.signedDate ?? v.signed_date,
            downloadUrl: v.downloadUrl ?? v.download_url,
          }),
        );

      case 'agreement_revision_sent':
        return this.toRendered(
          subject,
          agreementRevisionSentTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            agreementTitle: v.agreementTitle ?? v.agreement_title,
            agreementReference: v.agreementReference ?? v.agreement_reference,
            revisionSummary: v.revisionSummary ?? v.revision_summary,
            reviewUrl: v.reviewUrl ?? v.review_url,
            signUrl: v.signUrl ?? v.sign_url,
          }),
        );

      case 'terms_update_notice':
        return this.toRendered(
          subject,
          termsUpdatedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            effectiveDate: v.effectiveDate ?? v.effective_date,
            summary: v.summary,
            reviewUrl: v.reviewUrl ?? v.review_url,
          }),
        );

      case 'privacy_update_notice':
        return this.toRendered(
          subject,
          privacyUpdatedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            effectiveDate: v.effectiveDate ?? v.effective_date,
            summary: v.summary,
            reviewUrl: v.reviewUrl ?? v.review_url,
          }),
        );

      case 'compliance_request':
        return this.toRendered(
          subject,
          complianceRequestSentTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            requestLabel: v.requestLabel ?? v.request_label,
            dueDate: v.dueDate ?? v.due_date,
            details: v.details,
            actionUrl: v.actionUrl ?? v.action_url,
          }),
        );

      case 'formal_legal_notice':
        return this.toRendered(
          subject,
          formalNoticeSentTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            noticeTitle: v.noticeTitle ?? v.notice_title,
            noticeDate: v.noticeDate ?? v.notice_date,
            noticeReference: v.noticeReference ?? v.notice_reference,
            summary: v.summary,
            reviewUrl: v.reviewUrl ?? v.review_url,
          }),
        );

      case 'client_onboarding_started':
        return this.toRendered(
          subject,
          clientOnboardingStartedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            setupUrl: v.setupUrl ?? v.setup_url,
            nextStep: v.nextStep ?? v.next_step,
          }),
        );

      case 'client_onboarding_completed':
        return this.toRendered(
          subject,
          clientOnboardingCompletedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            dashboardUrl: v.dashboardUrl ?? v.dashboard_url ?? v.portal_url,
          }),
        );

      case 'campaign_launched':
        return this.toRendered(
          subject,
          campaignStartedTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            campaignName: v.campaignName ?? v.campaign_name,
            startDate: v.startDate ?? v.start_date,
            dashboardUrl: v.dashboardUrl ?? v.dashboard_url ?? v.portal_url,
          }),
        );

      case 'lead_delivery_notice':
        return this.toRendered(
          subject,
          leadDeliveryAvailableTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            leadCount: v.leadCount ?? v.lead_count,
            deliveryLabel: v.deliveryLabel ?? v.delivery_label,
            deliveryUrl: v.deliveryUrl ?? v.delivery_url,
          }),
        );

      case 'meeting_booked_notice':
        return this.toRendered(
          subject,
          meetingBookedNoticeTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            meetingLabel: v.meetingLabel ?? v.meeting_label,
            scheduledFor: v.scheduledFor ?? v.scheduled_for,
            workspaceUrl: v.workspaceUrl ?? v.workspace_url ?? v.portal_url,
          }),
        );

      case 'service_issue_alert':
        return this.toRendered(
          subject,
          serviceIssueNoticeTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            issueLabel: v.issueLabel ?? v.issue_label,
            summary: v.summary,
            workspaceUrl: v.workspaceUrl ?? v.workspace_url ?? v.portal_url,
          }),
        );

      case 'service_setup_reminder':
        return this.toRendered(
          subject,
          setupCompletionReminderTemplate({
            name: v.name ?? v.client_name ?? v.toName,
            missingItemLabel: v.missingItemLabel ?? v.missing_item_label,
            setupUrl: v.setupUrl ?? v.setup_url,
          }),
        );

      case 'contact_acknowledgement':
      case 'demo_acknowledgement':
      case 'newsletter_confirmation':
      default:
        return null;
    }
  }

  private toRendered(subject: string, html: string): RenderedEmail {
    return {
      subject,
      html,
      text: this.stripHtml(html),
    };
  }

  private defaultSubjectForEvent(event: EmailEvent, variables: Record<string, any>) {
    switch (event) {
      case 'account_welcome':
        return 'Welcome to Orchestrate';
      case 'account_email_verification':
      case 'secure_action_link':
        return 'Verify your email';
      case 'account_password_reset':
      case 'secure_action_link_expiring':
        return 'Reset your password';
      case 'account_security_notice':
      case 'system_status_notice':
        return 'Security alert';
      case 'account_approved':
        return 'Your account has been approved';
      case 'account_on_hold':
        return 'Action needed for your account';
      case 'subscription_created':
        return 'Subscription confirmed';
      case 'subscription_renewed':
        return 'Subscription renewed';
      case 'subscription_canceled':
        return 'Subscription canceled';
      case 'invoice_issued':
        return variables.invoice_number || variables.invoiceNumber
          ? `Invoice ${variables.invoice_number ?? variables.invoiceNumber} from Orchestrate`
          : 'Your invoice is ready';
      case 'invoice_payment_due_reminder':
        return variables.invoice_number || variables.invoiceNumber
          ? `Reminder: Invoice ${variables.invoice_number ?? variables.invoiceNumber} is due soon`
          : 'Invoice reminder';
      case 'invoice_payment_overdue_reminder':
        return variables.invoice_number || variables.invoiceNumber
          ? `Invoice ${variables.invoice_number ?? variables.invoiceNumber} is overdue`
          : 'Invoice overdue';
      case 'payment_received':
        return variables.invoice_number || variables.invoiceNumber
          ? `Payment received for invoice ${variables.invoice_number ?? variables.invoiceNumber}`
          : 'Payment received';
      case 'payment_failed':
        return 'Payment could not be completed';
      case 'refund_issued':
        return 'Refund issued';
      case 'statement_issued':
      case 'statement_ready_reminder':
        return 'Statement available';
      case 'agreement_sent':
      case 'agreement_signature_request':
        return 'Service agreement ready for review';
      case 'agreement_signed':
        return 'Agreement signed confirmation';
      case 'agreement_revision_sent':
        return 'Updated agreement ready for review';
      case 'terms_update_notice':
        return 'Terms updated';
      case 'privacy_update_notice':
        return 'Privacy notice updated';
      case 'compliance_request':
        return 'Compliance information requested';
      case 'formal_legal_notice':
        return variables.notice_title || variables.noticeTitle || 'Formal notice';
      case 'client_onboarding_started':
        return 'Onboarding started';
      case 'client_onboarding_completed':
        return 'Onboarding complete';
      case 'campaign_launched':
        return 'Campaign started';
      case 'lead_delivery_notice':
        return 'Lead delivery available';
      case 'meeting_booked_notice':
        return 'Meeting booked';
      case 'service_issue_alert':
        return 'Service notice';
      case 'service_setup_reminder':
        return 'Complete your setup';
      case 'contact_acknowledgement':
        return 'We received your message';
      case 'demo_acknowledgement':
        return 'Demo request received';
      case 'newsletter_confirmation':
        return 'Subscription confirmed';
      default:
        return 'Orchestrate';
    }
  }

  private renderString(input: string | null | undefined, variables: Record<string, unknown>) {
    if (!input) return null;
    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
      const value = variables[key];
      return value == null ? '' : String(value);
    });
  }

  private resolveEmailFromVariables(variables?: Record<string, unknown>) {
    if (!variables) return undefined;
    const candidate = (variables as any).to_email ?? (variables as any).email ?? (variables as any).client_email ?? (variables as any).recipient_email;
    return candidate == null ? undefined : String(candidate);
  }

  private getBaseUrl() {
    return process.env.APP_BASE_URL?.trim() || 'https://orchestrateops.com';
  }

  private getClientPortalUrl(clientId?: string) {
    const configured = process.env.CLIENT_PORTAL_BASE_URL?.trim() || 'https://orchestrateops.com/client';
    return clientId ? `${configured.replace(/\/$/, '')}?clientId=${clientId}` : configured;
  }

  private getBrandName() {
    return process.env.EMAIL_BRAND_NAME?.trim() || 'Orchestrate';
  }

  private resolveDeliveryMode(): 'resend' | 'log' | 'disabled' {
    const configured = (process.env.EMAIL_DELIVERY_MODE ?? '').trim().toLowerCase();
    if (configured === 'disabled') return 'disabled';
    if (configured === 'log') return 'log';
    if (configured === 'resend') return 'resend';
    return process.env.RESEND_API_KEY?.trim() ? 'resend' : 'log';
  }

  private resolveEvent(input: {
    explicitEvent?: string;
    explicitCategory?: string;
    templateType?: string;
    templateName?: string;
    subject?: string | null;
    body?: string | null;
  }): EmailEvent {
    const explicitEvent = this.normalizeEvent(input.explicitEvent);
    if (explicitEvent) return explicitEvent;

    const explicitCategory = this.normalizeCategory(input.explicitCategory);
    if (explicitCategory) {
      switch (explicitCategory) {
        case 'billing':
          return 'invoice_issued';
        case 'legal':
          return 'agreement_sent';
        case 'hello':
          return 'contact_acknowledgement';
        case 'no-reply':
          return 'secure_action_link';
        case 'support':
        default:
          return 'service_issue_alert';
      }
    }

    const haystack = [input.templateType ?? '', input.templateName ?? '', input.subject ?? '', input.body ?? '']
      .join(' ')
      .toLowerCase();

    if (/(verify|verification)/.test(haystack)) return 'account_email_verification';
    if (/(password reset|reset your password|reset link)/.test(haystack)) return 'account_password_reset';
    if (/(welcome to|welcome)/.test(haystack)) return 'account_welcome';
    if (/(invoice|bill issued)/.test(haystack)) return 'invoice_issued';
    if (/(payment due|due reminder)/.test(haystack)) return 'invoice_payment_due_reminder';
    if (/(overdue|past due)/.test(haystack)) return 'invoice_payment_overdue_reminder';
    if (/(receipt|payment received|payment confirmation|paid)/.test(haystack)) return 'payment_received';
    if (/(statement ready|statement issued|statement)/.test(haystack)) return 'statement_issued';
    if (/(agreement signature|signature request)/.test(haystack)) return 'agreement_signature_request';
    if (/(agreement|contract|terms)/.test(haystack)) return 'agreement_sent';
    if (/(privacy)/.test(haystack)) return 'privacy_update_notice';
    if (/(compliance|legal notice)/.test(haystack)) return 'formal_legal_notice';
    if (/(hello|contact|intro|outreach|demo)/.test(haystack)) return 'contact_acknowledgement';
    if (/(do not reply|no-reply)/.test(haystack)) return 'system_status_notice';

    return 'service_issue_alert';
  }

  private normalizeEvent(value?: string): EmailEvent | undefined {
    const normalized = (value ?? '').trim().toLowerCase();
    const allowed: EmailEvent[] = [
      'account_welcome',
      'account_email_verification',
      'account_password_reset',
      'account_security_notice',
      'account_approved',
      'account_on_hold',
      'contact_acknowledgement',
      'demo_acknowledgement',
      'newsletter_confirmation',
      'subscription_created',
      'subscription_renewed',
      'subscription_canceled',
      'invoice_issued',
      'invoice_payment_due_reminder',
      'invoice_payment_overdue_reminder',
      'payment_received',
      'payment_failed',
      'refund_issued',
      'statement_issued',
      'statement_ready_reminder',
      'agreement_sent',
      'agreement_signature_request',
      'agreement_signed',
      'agreement_revision_sent',
      'terms_update_notice',
      'privacy_update_notice',
      'compliance_request',
      'formal_legal_notice',
      'client_onboarding_started',
      'client_onboarding_completed',
      'campaign_launched',
      'lead_delivery_notice',
      'meeting_booked_notice',
      'service_issue_alert',
      'service_setup_reminder',
      'system_status_notice',
      'secure_action_link',
      'secure_action_link_expiring',
    ];
    return allowed.find((event) => event === normalized);
  }

  private resolveEventCategory(event: EmailEvent): EmailCategory {
    switch (event) {
      case 'account_email_verification':
      case 'account_password_reset':
      case 'secure_action_link':
      case 'secure_action_link_expiring':
      case 'system_status_notice':
        return 'no-reply';

      case 'contact_acknowledgement':
      case 'demo_acknowledgement':
      case 'newsletter_confirmation':
      case 'account_welcome':
        return 'hello';

      case 'subscription_created':
      case 'subscription_renewed':
      case 'subscription_canceled':
      case 'invoice_issued':
      case 'invoice_payment_due_reminder':
      case 'invoice_payment_overdue_reminder':
      case 'payment_received':
      case 'payment_failed':
      case 'refund_issued':
      case 'statement_issued':
      case 'statement_ready_reminder':
        return 'billing';

      case 'agreement_sent':
      case 'agreement_signature_request':
      case 'agreement_signed':
      case 'agreement_revision_sent':
      case 'terms_update_notice':
      case 'privacy_update_notice':
      case 'compliance_request':
      case 'formal_legal_notice':
        return 'legal';

      case 'account_security_notice':
      case 'account_approved':
      case 'account_on_hold':
      case 'client_onboarding_started':
      case 'client_onboarding_completed':
      case 'campaign_launched':
      case 'lead_delivery_notice':
      case 'meeting_booked_notice':
      case 'service_issue_alert':
      case 'service_setup_reminder':
      default:
        return 'support';
    }
  }

  private normalizeCategory(value?: string): EmailCategory | undefined {
    const normalized = (value ?? '').trim().toLowerCase();
    if (
      normalized === 'support' ||
      normalized === 'billing' ||
      normalized === 'legal' ||
      normalized === 'hello' ||
      normalized === 'no-reply'
    ) {
      return normalized;
    }
    return undefined;
  }

  private resolveProfile(category: EmailCategory, replyToOverride?: string): EmailProfile {
    const fallbackBrand = this.getBrandName();
    const supportFrom = process.env.EMAIL_FROM_SUPPORT?.trim() || `${fallbackBrand} <support@orchestrateops.com>`;
    const billingFrom = process.env.EMAIL_FROM_BILLING?.trim() || `${fallbackBrand} <billing@orchestrateops.com>`;
    const legalFrom = process.env.EMAIL_FROM_LEGAL?.trim() || `${fallbackBrand} <legal@orchestrateops.com>`;
    const helloFrom = process.env.EMAIL_FROM_HELLO?.trim() || `${fallbackBrand} <hello@orchestrateops.com>`;
    const noReplyFrom =
      process.env.EMAIL_FROM_NO_REPLY?.trim() || `${fallbackBrand} <no-reply@orchestrateops.com>`;

    const profileByCategory: Record<EmailCategory, EmailProfile> = {
      support: {
        category: 'support',
        from: supportFrom,
        replyTo: process.env.EMAIL_REPLY_TO_SUPPORT?.trim() || 'support@orchestrateops.com',
      },
      billing: {
        category: 'billing',
        from: billingFrom,
        replyTo: process.env.EMAIL_REPLY_TO_BILLING?.trim() || 'billing@orchestrateops.com',
      },
      legal: {
        category: 'legal',
        from: legalFrom,
        replyTo: process.env.EMAIL_REPLY_TO_LEGAL?.trim() || 'legal@orchestrateops.com',
      },
      hello: {
        category: 'hello',
        from: helloFrom,
        replyTo: process.env.EMAIL_REPLY_TO_HELLO?.trim() || 'hello@orchestrateops.com',
      },
      'no-reply': {
        category: 'no-reply',
        from: noReplyFrom,
      },
    };

    const resolved = profileByCategory[category];
    return {
      ...resolved,
      replyTo: replyToOverride?.trim() || resolved.replyTo,
    };
  }

  private formatRecipient(email: string, name?: string) {
    const trimmedEmail = email.trim();
    const trimmedName = name?.trim();
    if (!trimmedName) return trimmedEmail;
    const safeName = trimmedName.replace(/"/g, '').trim();
    return `${safeName} <${trimmedEmail}>`;
  }

  private textToHtml(text: string) {
    const escaped = this.escapeHtml(text || '');
    const paragraphs = escaped
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
      .join('');

    return `<div>${paragraphs || '<p></p>'}</div>`;
  }

  private stripHtml(input: string) {
    return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private escapeHtml(input: string) {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private extractEmailAddress(input: unknown): string | undefined {
    const candidate = this.findEmailValue(input);
    if (!candidate) return undefined;

    const trimmed = candidate.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : undefined;
  }

  private findEmailValue(input: unknown): string | undefined {
    if (!input) return undefined;

    if (typeof input === 'string') {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim()) ? input.trim() : undefined;
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        const found = this.findEmailValue(item);
        if (found) return found;
      }
      return undefined;
    }

    if (typeof input !== 'object') {
      return undefined;
    }

    const record = input as Record<string, unknown>;
    const prioritizedKeys = [
      'email',
      'to_email',
      'client_email',
      'recipient_email',
      'primary_email',
      'billing_email',
      'contact_email',
      'emailAddress',
      'email_address',
    ];

    for (const key of prioritizedKeys) {
      const value = record[key];
      if (typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        return value.trim();
      }
    }

    for (const value of Object.values(record)) {
      const found = this.findEmailValue(value);
      if (found) return found;
    }

    return undefined;
  }
}
