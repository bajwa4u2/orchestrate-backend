import { Injectable } from '@nestjs/common';
import { MeetingStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { CreatePublicContactDto, PublicInquiryTypeDto } from './dto/create-public-contact.dto';
import { getPlansGrouped } from '../billing/pricing/plan-catalog.service';
import { IntakeService } from '../intake/intake.service';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
    private readonly intakeService: IntakeService,
  ) {}

  async getOverview() {
    const [
      leadsActive,
      outreachSent,
      repliesReceived,
      meetingsScheduled,
      invoiceTotals,
      paymentTotals,
      publicInquiryCount,
    ] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.outreachMessage.count({ where: { sentAt: { not: null } } }),
      this.prisma.reply.count(),
      this.prisma.meeting.count({ where: { status: MeetingStatus.BOOKED } }),
      this.prisma.invoice.aggregate({
        _sum: {
          totalCents: true,
          amountPaidCents: true,
          balanceDueCents: true,
        },
      }),
      this.prisma.payment.aggregate({
        _sum: {
          amountCents: true,
        },
      }),
      this.prisma.publicInquiry.count(),
    ]);

    return {
      leadsActive,
      outreachSent,
      repliesReceived,
      meetingsScheduled,
      invoicesIssuedAmount: Math.round((invoiceTotals._sum.totalCents ?? 0) / 100),
      paymentsClearedAmount: Math.round((invoiceTotals._sum.amountPaidCents ?? paymentTotals._sum.amountCents ?? 0) / 100),
      paymentsDueAmount: Math.round((invoiceTotals._sum.balanceDueCents ?? 0) / 100),
      inquiriesReceived: publicInquiryCount,
      status: {
        source: 'database',
        note: 'Live operational aggregates from the current orchestrate database.',
      },
    };
  }

  async getPricing() {
    const configuredTrialDays = (() => {
      const raw = process.env.STRIPE_TRIAL_DAYS?.trim();
      if (!raw) return 15;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.min(30, Math.floor(parsed))) : 0;
    })();

    const grouped = getPlansGrouped();

    return {
      trialDays: configuredTrialDays,
      plans: [
        ...grouped.opportunity.map((plan) => ({
          code: `opportunity_${plan.tier}`,
          lane: plan.lane,
          tier: plan.tier,
          name: `Opportunity ${plan.label}`,
          amountCents: plan.amountCents,
          displayPrice: plan.displayPrice,
          currencyCode: plan.currency.toUpperCase(),
          interval: plan.interval,
          trialDays: configuredTrialDays,
          summary: plan.description,
        })),
        ...grouped.revenue.map((plan) => ({
          code: `revenue_${plan.tier}`,
          lane: plan.lane,
          tier: plan.tier,
          name: `Revenue ${plan.label}`,
          amountCents: plan.amountCents,
          displayPrice: plan.displayPrice,
          currencyCode: plan.currency.toUpperCase(),
          interval: plan.interval,
          trialDays: configuredTrialDays,
          summary: plan.description,
        })),
      ],
      grouped: {
        opportunity: grouped.opportunity.map((plan) => ({
          lane: plan.lane,
          tier: plan.tier,
          label: plan.label,
          amountCents: plan.amountCents,
          displayPrice: plan.displayPrice,
          currencyCode: plan.currency.toUpperCase(),
          interval: plan.interval,
          description: plan.description,
        })),
        revenue: grouped.revenue.map((plan) => ({
          lane: plan.lane,
          tier: plan.tier,
          label: plan.label,
          amountCents: plan.amountCents,
          displayPrice: plan.displayPrice,
          currencyCode: plan.currency.toUpperCase(),
          interval: plan.interval,
          description: plan.description,
        })),
      },
      sequence: [
        'Choose plan',
        'Create account',
        'Verify email',
        'Define operating profile',
        'Activate subscription',
        'Begin service',
      ],
    };
  }

  async submitContact(dto: CreatePublicContactDto) {
    const normalized = {
      name: dto.name.trim(),
      email: dto.email.trim().toLowerCase(),
      company: dto.company?.trim() || null,
      inquiryType: dto.inquiryType,
      message: dto.message.trim(),
    };

    const intakeResult = await this.intakeService.handlePublic({
      source: 'PUBLIC',
      name: normalized.name,
      email: normalized.email,
      company: normalized.company,
      inquiryTypeHint: normalized.inquiryType,
      message: normalized.message,
      sourcePage: 'contact',
    });

    if (intakeResult.status === 'resolved') {
      return {
        ok: true,
        mode: 'resolved',
        message: intakeResult.reply,
        category: intakeResult.category,
        priority: intakeResult.priority,
      };
    }

    if (intakeResult.status === 'needs_follow_up') {
      return {
        ok: true,
        mode: 'needs_follow_up',
        message: intakeResult.reply,
        questions: intakeResult.questions,
        sessionId: intakeResult.sessionId,
        category: intakeResult.category,
        priority: intakeResult.priority,
      };
    }

    const inquiry = await this.prisma.publicInquiry.create({
      data: {
        name: normalized.name,
        email: normalized.email,
        company: normalized.company,
        inquiryType: normalized.inquiryType as any,
        message: normalized.message,
        metadataJson: {
          route: '/contact',
          origin: 'public_web',
          intake: {
            category: intakeResult.category,
            priority: intakeResult.priority,
            sessionId: intakeResult.sessionId,
            caseId: intakeResult.caseId,
          },
        },
      },
    });

    const contactRoute = this.resolveContactRoute(normalized.inquiryType);
    const notificationResults = await Promise.allSettled(
      contactRoute.to.map((toEmail) =>
        this.emailsService.sendDirectEmail({
          toEmail,
          toName: 'Orchestrate',
          category: contactRoute.category,
          emailEvent: 'contact_inquiry_notification',
          replyToEmail: normalized.email,
          subject: `New inquiry — ${this.inquiryTypeLabel(normalized.inquiryType)} — ${normalized.name}`,
          bodyText: this.buildInternalNotificationText({
            inquiryId: inquiry.id,
            ...normalized,
          }),
          bodyHtml: this.textToHtml(
            this.buildInternalNotificationText({
              inquiryId: inquiry.id,
              ...normalized,
            }),
          ),
          templateVariables: {
            inquiry_id: inquiry.id,
            inquiry_type: normalized.inquiryType,
            inquiry_type_label: this.inquiryTypeLabel(normalized.inquiryType),
            sender_name: normalized.name,
            sender_email: normalized.email,
            company: normalized.company ?? '',
            message: normalized.message,
            submitted_at: new Date().toISOString(),
            routed_to: contactRoute.to.join(', '),
            intake_category: intakeResult.category,
            intake_priority: intakeResult.priority,
          },
        }),
      ),
    );

    const deliveredNotifications = notificationResults.filter((result) => result.status === 'fulfilled').length;

    let acknowledged = false;
    try {
      await this.emailsService.sendDirectEmail({
        toEmail: normalized.email,
        toName: normalized.name,
        category: contactRoute.category,
        emailEvent: 'contact_acknowledgement',
        replyToEmail: contactRoute.replyTo,
        subject: 'We received your inquiry',
        bodyText: this.buildAcknowledgementText(normalized.name, normalized.inquiryType, contactRoute.replyTo),
        bodyHtml: this.textToHtml(this.buildAcknowledgementText(normalized.name, normalized.inquiryType, contactRoute.replyTo)),
        templateVariables: {
          name: normalized.name,
          inquiry_type_label: this.inquiryTypeLabel(normalized.inquiryType),
          response_email: contactRoute.replyTo,
        },
      });
      acknowledged = true;
    } catch (error) {
      console.error('[public.contact] acknowledgement delivery failed', error);
    }

    const nextStatus = acknowledged
      ? 'ACKNOWLEDGED'
      : deliveredNotifications > 0
        ? 'NOTIFIED'
        : 'RECEIVED';

    await this.prisma.publicInquiry.update({
      where: { id: inquiry.id },
      data: {
        status: nextStatus as any,
        notifiedAt: deliveredNotifications > 0 ? new Date() : undefined,
        acknowledgedAt: acknowledged ? new Date() : undefined,
      },
    });

    return {
      ok: true,
      mode: 'escalated',
      inquiryId: inquiry.id,
      status: nextStatus,
      notification: {
        recipients: contactRoute.to,
        deliveredCount: deliveredNotifications,
        queuedCount: contactRoute.to.length - deliveredNotifications,
      },
      acknowledgement: {
        sent: acknowledged,
      },
      category: intakeResult.category,
      priority: intakeResult.priority,
      message:
        deliveredNotifications > 0
          ? 'Your inquiry has been received and routed.'
          : 'Your inquiry has been received and saved for follow-up.',
    };
  }

  async submitIntake(input: {
    message: string;
    name?: string | null;
    email?: string | null;
    company?: string | null;
    sourcePage?: string | null;
    inquiryTypeHint?: string | null;
  }) {
    const normalized = {
      message: input.message.trim(),
      name: input.name?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      company: input.company?.trim() || null,
      sourcePage: input.sourcePage?.trim() || 'public',
      inquiryTypeHint: input.inquiryTypeHint?.trim() || null,
    };

    return this.intakeService.handlePublic({
      source: 'PUBLIC',
      message: normalized.message,
      name: normalized.name,
      email: normalized.email,
      company: normalized.company,
      sourcePage: normalized.sourcePage,
      inquiryTypeHint: normalized.inquiryTypeHint,
    });
  }

  async replyToIntakeSession(sessionId: string, message: string) {
    return this.intakeService.replyPublic(sessionId, message.trim());
  }

  private resolveContactRoute(inquiryType: PublicInquiryTypeDto) {
    const hello = process.env.CONTACT_EMAIL_HELLO?.trim() || process.env.EMAIL_REPLY_TO_HELLO?.trim() || 'hello@orchestrateops.com';
    const support = process.env.CONTACT_EMAIL_SUPPORT?.trim() || process.env.EMAIL_REPLY_TO_SUPPORT?.trim() || 'support@orchestrateops.com';

    switch (inquiryType) {
      case PublicInquiryTypeDto.BILLING_SUPPORT:
      case PublicInquiryTypeDto.ONBOARDING:
        return {
          to: [support],
          replyTo: support,
          category: 'support' as const,
        };
      case PublicInquiryTypeDto.SERVICE_FIT:
      case PublicInquiryTypeDto.PRICING:
      case PublicInquiryTypeDto.PARTNERSHIP:
      case PublicInquiryTypeDto.GENERAL_INQUIRY:
      default:
        return {
          to: [hello],
          replyTo: hello,
          category: 'hello' as const,
        };
    }
  }

  private inquiryTypeLabel(type: PublicInquiryTypeDto) {
    const labels: Record<PublicInquiryTypeDto, string> = {
      [PublicInquiryTypeDto.SERVICE_FIT]: 'Service fit',
      [PublicInquiryTypeDto.PRICING]: 'Pricing',
      [PublicInquiryTypeDto.BILLING_SUPPORT]: 'Billing support',
      [PublicInquiryTypeDto.ONBOARDING]: 'Onboarding',
      [PublicInquiryTypeDto.PARTNERSHIP]: 'Partnership',
      [PublicInquiryTypeDto.GENERAL_INQUIRY]: 'General inquiry',
    };

    return labels[type];
  }

  private buildInternalNotificationText(input: {
    inquiryId: string;
    name: string;
    email: string;
    company: string | null;
    inquiryType: PublicInquiryTypeDto;
    message: string;
  }) {
    return [
      'A new contact inquiry was submitted on orchestrateops.com.',
      '',
      `Inquiry ID: ${input.inquiryId}`,
      `Inquiry type: ${this.inquiryTypeLabel(input.inquiryType)}`,
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      `Company: ${input.company || 'Not provided'}`,
      '',
      'Message:',
      input.message,
    ].join('\n');
  }

  private buildAcknowledgementText(name: string, inquiryType: PublicInquiryTypeDto, responseEmail: string) {
    return [
      `Hi ${name},`,
      '',
      `We received your ${this.inquiryTypeLabel(inquiryType).toLowerCase()} inquiry and added it to our intake queue.`,
      '',
      `Someone from Orchestrate will review it and continue the conversation from ${responseEmail}.`,
      '',
      'Thank you,',
      'Orchestrate',
    ].join('\n');
  }

  private textToHtml(text: string) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const paragraphs = escaped
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
      .join('');

    return `<div>${paragraphs}</div>`;
  }
}
