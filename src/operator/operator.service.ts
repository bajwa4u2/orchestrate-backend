import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PublicInquiryStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { ControlService } from '../control/control.service';
import { EmailsService } from '../emails/emails.service';
import { CreateInquiryNoteDto } from './dto/create-inquiry-note.dto';
import { CreateInquiryReplyDto } from './dto/create-inquiry-reply.dto';
import { PublicInquiryStatusDto } from './dto/update-inquiry-status.dto';

@Injectable()
export class OperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly controlService: ControlService,
    private readonly billingService: BillingService,
    private readonly emailsService: EmailsService,
  ) {}

  commandOverview(organizationId: string) {
    return this.controlService.overview(organizationId);
  }

  revenueOverview(organizationId: string) {
    return this.billingService.overview(organizationId);
  }

  async recordsOverview(organizationId: string) {
    const [
      clients,
      campaigns,
      leads,
      replies,
      meetings,
      agreements,
      statements,
      reminders,
      templates,
      alerts,
      emailDispatches,
    ] = await Promise.all([
      this.prisma.client.count({ where: { organizationId } }),
      this.prisma.campaign.count({ where: { organizationId } }),
      this.prisma.lead.count({ where: { organizationId } }),
      this.prisma.reply.count({ where: { organizationId } }),
      this.prisma.meeting.count({ where: { organizationId } }),
      this.prisma.serviceAgreement.count({ where: { organizationId } }),
      this.prisma.statement.count({ where: { organizationId } }),
      this.prisma.reminderArtifact.count({ where: { organizationId } }),
      this.prisma.template.count({ where: { organizationId } }),
      this.prisma.alert.count({ where: { organizationId } }),
      this.prisma.documentDispatch.count({ where: { organizationId, deliveryChannel: 'EMAIL' } }),
    ]);

    return {
      clients,
      campaigns,
      leads,
      replies,
      meetings,
      agreements,
      statements,
      reminders,
      templates,
      alerts,
      emailDispatches,
    };
  }

  async listPublicInquiries(limitInput?: string) {
    const parsedLimit = Number.parseInt(limitInput ?? '', 10);
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 24;

    const [items, newCount, acknowledgedCount, inProgressCount, closedCount, spamCount] = await Promise.all([
      this.prisma.publicInquiry.findMany({
        orderBy: { submittedAt: 'desc' },
        take,
        include: {
          assignedTo: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.publicInquiry.count({ where: { status: 'NEW' } }),
      this.prisma.publicInquiry.count({ where: { status: 'ACKNOWLEDGED' } }),
      this.prisma.publicInquiry.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.publicInquiry.count({ where: { status: 'CLOSED' } }),
      this.prisma.publicInquiry.count({ where: { status: 'SPAM' } }),
    ]);

    return {
      items,
      summary: {
        totalOpen: newCount + acknowledgedCount + inProgressCount,
        NEW: newCount,
        ACKNOWLEDGED: acknowledgedCount,
        IN_PROGRESS: inProgressCount,
        CLOSED: closedCount,
        SPAM: spamCount,
      },
    };
  }

  async getPublicInquiry(id: string, actorUserId?: string) {
    const inquiry = await this.prisma.publicInquiry.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, fullName: true, email: true } },
        thread: {
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              include: {
                author: { select: { id: true, fullName: true, email: true } },
              },
            },
          },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: {
            author: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });

    if (!inquiry) throw new NotFoundException('Inquiry not found');

    if (inquiry.status === 'NEW') {
      await this.prisma.publicInquiry.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: inquiry.acknowledgedAt ?? new Date(),
        },
      });

      if (inquiry.thread && actorUserId) {
        await this.prisma.inquiryMessage.create({
          data: {
            threadId: inquiry.thread.id,
            authorUserId: actorUserId,
            type: 'SYSTEM',
            bodyText: 'Inquiry acknowledged in operator workspace.',
          },
        });
      }

      return this.getPublicInquiry(id);
    }

    return inquiry;
  }

  async updatePublicInquiryStatus(id: string, status: PublicInquiryStatusDto, actorUserId?: string) {
    const inquiry = await this.prisma.publicInquiry.findUnique({
      where: { id },
      include: { thread: true },
    });
    if (!inquiry) throw new NotFoundException('Inquiry not found');

    const normalizedStatus = status as PublicInquiryStatus;
    const updated = await this.prisma.publicInquiry.update({
      where: { id },
      data: {
        status: normalizedStatus,
        acknowledgedAt:
          normalizedStatus === 'ACKNOWLEDGED' || normalizedStatus === 'IN_PROGRESS'
            ? inquiry.acknowledgedAt ?? new Date()
            : inquiry.acknowledgedAt,
        closedAt: normalizedStatus === 'CLOSED' ? new Date() : null,
      },
    });

    if (inquiry.thread) {
      await this.prisma.inquiryMessage.create({
        data: {
          threadId: inquiry.thread.id,
          authorUserId: actorUserId,
          type: 'SYSTEM',
          bodyText: `Status changed to ${normalizedStatus.replaceAll('_', ' ').toLowerCase()}.`,
        },
      });
    }

    return updated;
  }

  async assignPublicInquiry(id: string, assignedToUserId: string | undefined, actorUserId?: string) {
    const inquiry = await this.prisma.publicInquiry.findUnique({
      where: { id },
      include: { thread: true },
    });
    if (!inquiry) throw new NotFoundException('Inquiry not found');

    let assignedUser:
      | {
          id: string;
          fullName: string;
          email: string;
        }
      | null = null;

    if (assignedToUserId != null && assignedToUserId.trim().isNotEmpty) {
      assignedUser = await this.prisma.user.findUnique({
        where: { id: assignedToUserId.trim() },
        select: { id: true, fullName: true, email: true },
      });
      if (!assignedUser) throw new BadRequestException('Assigned user was not found');
    }

    const updated = await this.prisma.publicInquiry.update({
      where: { id },
      data: {
        assignedToUserId: assignedUser?.id ?? null,
      },
      include: {
        assignedTo: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (inquiry.thread) {
      await this.prisma.inquiryMessage.create({
        data: {
          threadId: inquiry.thread.id,
          authorUserId: actorUserId,
          type: 'SYSTEM',
          bodyText: assignedUser == null ? 'Inquiry assignment cleared.' : `Inquiry assigned to ${assignedUser.fullName}.`,
        },
      });
    }

    return updated;
  }

  async addInquiryReply(id: string, actorUserId: string, dto: CreateInquiryReplyDto) {
    const inquiry = await this.prisma.publicInquiry.findUnique({
      where: { id },
      include: { thread: true },
    });
    if (!inquiry || !inquiry.thread) throw new NotFoundException('Inquiry not found');

    const cleanBody = dto.bodyText.trim();
    if (!cleanBody) throw new BadRequestException('Reply body is required');

    const route = this.resolveContactRoute(inquiry.inquiryType);
    let emailDeliveredAt: Date | null = null;

    if (dto.sendEmail != false) {
      await this.emailsService.sendDirectEmail({
        toEmail: inquiry.email,
        toName: inquiry.name,
        category: route.category,
        replyToEmail: route.replyTo,
        subject: 'Re: Your inquiry to Orchestrate',
        bodyText: cleanBody,
        bodyHtml: this.textToHtml(cleanBody),
      });
      emailDeliveredAt = new Date();
    }

    await this.prisma.inquiryMessage.create({
      data: {
        threadId: inquiry.thread.id,
        authorUserId: actorUserId,
        type: 'OPERATOR',
        bodyText: cleanBody,
        emailDeliveredAt,
        metadataJson: {
          sentEmail: dto.sendEmail != false,
        },
      },
    });

    await this.prisma.publicInquiry.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        acknowledgedAt: inquiry.acknowledgedAt ?? new Date(),
      },
    });

    return this.getPublicInquiry(id);
  }

  async addInquiryNote(id: string, organizationId: string, actorUserId: string, dto: CreateInquiryNoteDto) {
    const inquiry = await this.prisma.publicInquiry.findUnique({ where: { id } });
    if (!inquiry) throw new NotFoundException('Inquiry not found');

    await this.prisma.note.create({
      data: {
        organizationId,
        inquiryId: id,
        authorUserId: actorUserId,
        bodyText: dto.bodyText.trim(),
        metadataJson: {
          source: 'operator_inquiry_workspace',
        },
      },
    });

    return this.getPublicInquiry(id);
  }

  private resolveContactRoute(inquiryType: string) {
    const hello = process.env.CONTACT_EMAIL_HELLO?.trim() || process.env.EMAIL_REPLY_TO_HELLO?.trim() || 'hello@orchestrateops.com';
    const support = process.env.CONTACT_EMAIL_SUPPORT?.trim() || process.env.EMAIL_REPLY_TO_SUPPORT?.trim() || 'support@orchestrateops.com';

    switch (inquiryType) {
      case 'BILLING_SUPPORT':
      case 'ONBOARDING':
        return {
          replyTo: support,
          category: 'support' as const,
        };
      default:
        return {
          replyTo: hello,
          category: 'hello' as const,
        };
    }
  }

  private textToHtml(text: string) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    return `<div style="white-space:pre-wrap;font-family:Inter,Arial,sans-serif;line-height:1.6;">${escaped}</div>`;
  }
}
