import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { CreatePublicContactDto, PublicInquiryTypeDto } from './dto/create-public-contact.dto';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
  ) {}

  async getOverview() {
    return {
      leadsActive: 34,
      outreachSent: 126,
      repliesReceived: 18,
      meetingsScheduled: 6,
      invoicesIssuedAmount: 12400,
      paymentsClearedAmount: 8200,
      paymentsDueAmount: 4200,
      status: {
        source: 'foundation',
        note: 'Replace in PublicService with database aggregation once the live orchestrate database service and current module files are wired in this backend.',
      },
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
        },
      },
    });

    const notificationRecipients = this.getNotificationRecipients();
    const notificationResults = await Promise.allSettled(
      notificationRecipients.map((toEmail) =>
        this.emailsService.sendDirectEmail({
          toEmail,
          toName: 'Orchestrate',
          category: 'support',
          replyToEmail: normalized.email,
          subject: `New contact inquiry: ${this.inquiryTypeLabel(normalized.inquiryType)}`,
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
        category: 'hello',
        emailEvent: 'contact_acknowledgement',
        replyToEmail: process.env.EMAIL_REPLY_TO_HELLO?.trim() || 'hello@orchestrateops.com',
        subject: 'We received your message',
        bodyText: this.buildAcknowledgementText(normalized.name, normalized.inquiryType),
        bodyHtml: this.textToHtml(this.buildAcknowledgementText(normalized.name, normalized.inquiryType)),
        templateVariables: {
          name: normalized.name,
          inquiry_type_label: this.inquiryTypeLabel(normalized.inquiryType),
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
      inquiryId: inquiry.id,
      status: nextStatus,
      notification: {
        recipients: notificationRecipients,
        deliveredCount: deliveredNotifications,
        queuedCount: notificationRecipients.length - deliveredNotifications,
      },
      acknowledgement: {
        sent: acknowledged,
      },
      message:
        deliveredNotifications > 0
          ? 'Your inquiry has been received and routed.'
          : 'Your inquiry has been received and saved for follow-up.',
    };
  }

  private getNotificationRecipients() {
    const configured = (process.env.PUBLIC_CONTACT_NOTIFY_TO || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    return configured.length ? configured : ['support@orchestrateops.com', 'hello@orchestrateops.com'];
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

  private buildAcknowledgementText(name: string, inquiryType: PublicInquiryTypeDto) {
    return [
      `Hi ${name},`,
      '',
      `We received your ${this.inquiryTypeLabel(inquiryType).toLowerCase()} inquiry and added it to our intake queue.`,
      '',
      'Someone from Orchestrate will review it and continue the conversation from hello@orchestrateops.com or support@orchestrateops.com.',
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
