import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InquiryChannel,
  InquiryDirection,
  InquiryMessageType,
  Prisma,
  PublicInquiryStatus,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { ControlService } from '../control/control.service';
import { PrismaService } from '../database/prisma.service';
import { AssignInquiryDto } from './dto/assign-inquiry.dto';
import { CreateInquiryNoteDto } from './dto/create-inquiry-note.dto';
import { CreateInquiryReplyDto } from './dto/create-inquiry-reply.dto';
import {
  PublicInquiryStatusDto,
  UpdateInquiryStatusDto,
} from './dto/update-inquiry-status.dto';

@Injectable()
export class OperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly controlService: ControlService,
    private readonly billingService: BillingService,
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
      this.prisma.documentDispatch.count({
        where: { organizationId, deliveryChannel: 'EMAIL' },
      }),
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

  async listPublicInquiries(
    organizationId: string,
    filters: { limit?: string; status?: string; q?: string } = {},
  ) {
    const parsedLimit = Number.parseInt(filters.limit ?? '', 10);
    const take = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    const where: Prisma.PublicInquiryWhereInput = {};
    const normalizedStatus = this.parseStatus(filters.status);
    if (normalizedStatus) {
      where.status = normalizedStatus;
    }

    const q = filters.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, summary] = await Promise.all([
      this.prisma.publicInquiry.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { submittedAt: 'desc' }],
        take,
        include: {
          assignedTo: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
      this.inquirySummary(),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        company: item.company,
        inquiryType: item.inquiryType,
        type: this.humanizeInquiryType(item.inquiryType),
        status: item.status,
        message: item.message,
        submittedAt: item.submittedAt,
        createdAt: item.submittedAt,
        notifiedAt: item.notifiedAt,
        acknowledgedAt: item.acknowledgedAt,
        closedAt: item.closedAt,
        assignedToUserId: item.assignedToUserId,
        assignedToName: item.assignedTo?.fullName ?? '',
        isEscalated: item.isEscalated,
        lastActivityAt: item.lastActivityAt,
      })),
      summary,
    };
  }

  async getInquiryDetail(organizationId: string, inquiryId: string) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    return {
      id: inquiry.id,
      name: inquiry.name,
      email: inquiry.email,
      company: inquiry.company,
      inquiryType: inquiry.inquiryType,
      type: this.humanizeInquiryType(inquiry.inquiryType),
      status: inquiry.status,
      source: inquiry.source,
      message: inquiry.message,
      submittedAt: inquiry.submittedAt,
      createdAt: inquiry.submittedAt,
      notifiedAt: inquiry.notifiedAt,
      acknowledgedAt: inquiry.acknowledgedAt,
      closedAt: inquiry.closedAt,
      assignedToUserId: inquiry.assignedToUserId,
      assignedToName: inquiry.assignedTo?.fullName ?? '',
      assignedAt: inquiry.assignedAt,
      isEscalated: inquiry.isEscalated,
      escalatedAt: inquiry.escalatedAt,
      firstResponseDueAt: inquiry.firstResponseDueAt,
      nextResponseDueAt: inquiry.nextResponseDueAt,
      firstRespondedAt: inquiry.firstRespondedAt,
      lastInboundAt: inquiry.lastInboundAt,
      lastOutboundAt: inquiry.lastOutboundAt,
      lastActivityAt: inquiry.lastActivityAt,
      mailboxId: inquiry.mailboxId,
      externalThreadId: inquiry.externalThreadId,
      lastSyncedAt: inquiry.lastSyncedAt,
    };
  }

  async updateInquiryStatus(
    organizationId: string,
    inquiryId: string,
    dto: UpdateInquiryStatusDto,
    actorUserId: string,
  ) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    const status = dto.status;
    const now = new Date();

    const data: Prisma.PublicInquiryUpdateInput = {
      status,
      lastActivityAt: now,
      acknowledgedAt:
        status === PublicInquiryStatus.ACKNOWLEDGED ||
        status === PublicInquiryStatus.IN_PROGRESS
          ? inquiry.acknowledgedAt ?? now
          : inquiry.acknowledgedAt,
      firstRespondedAt:
        status === PublicInquiryStatus.IN_PROGRESS
          ? inquiry.firstRespondedAt ?? now
          : inquiry.firstRespondedAt,
      closedAt:
        status === PublicInquiryStatus.CLOSED || status === PublicInquiryStatus.SPAM
          ? now
          : null,
      isEscalated:
        status === PublicInquiryStatus.CLOSED || status === PublicInquiryStatus.SPAM
          ? false
          : inquiry.isEscalated,
      escalatedAt:
        status === PublicInquiryStatus.CLOSED || status === PublicInquiryStatus.SPAM
          ? null
          : inquiry.escalatedAt,
    };

    const updated = await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data,
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.SYSTEM,
        channel: InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.STATUS_CHANGE,
        bodyText: `Status changed to ${this.humanizeStatus(status)}.`,
        createdByUserId: actorUserId,
      },
    });

    return {
      ok: true,
      inquiry: {
        id: updated.id,
        status: updated.status,
        acknowledgedAt: updated.acknowledgedAt,
        closedAt: updated.closedAt,
        assignedToName: updated.assignedTo?.fullName ?? '',
        lastActivityAt: updated.lastActivityAt,
      },
    };
  }

  async assignInquiry(
    organizationId: string,
    inquiryId: string,
    dto: AssignInquiryDto,
    actorUserId: string,
  ) {
    await this.requireInquiry(organizationId, inquiryId);
    const assignedToUserId = dto.assignedToUserId?.trim() || null;

    if (assignedToUserId) {
      const membership = await this.prisma.workspaceMember.findFirst({
        where: {
          organizationId,
          userId: assignedToUserId,
          isActive: true,
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      if (!membership) {
        throw new BadRequestException('Assigned user is not an active member of this organization');
      }
    }

    const now = new Date();
    const updated = await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data: {
        assignedToUserId,
        assignedAt: assignedToUserId ? now : null,
        lastActivityAt: now,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const assignmentText = updated.assignedTo
      ? `Assigned to ${updated.assignedTo.fullName || updated.assignedTo.email}.`
      : 'Assignment cleared.';

    await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.SYSTEM,
        channel: InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.ASSIGNMENT,
        bodyText: assignmentText,
        createdByUserId: actorUserId,
      },
    });

    return {
      ok: true,
      inquiry: {
        id: updated.id,
        assignedToUserId: updated.assignedToUserId,
        assignedToName: updated.assignedTo?.fullName ?? '',
        assignedAt: updated.assignedAt,
        lastActivityAt: updated.lastActivityAt,
      },
    };
  }

  async getInquiryThread(organizationId: string, inquiryId: string) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    const messages = await this.prisma.inquiryMessage.findMany({
      where: { inquiryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const initialMessage = {
      id: `initial:${inquiry.id}`,
      type: 'USER',
      content: inquiry.message,
      createdAt: inquiry.submittedAt,
      fromEmail: inquiry.email,
      toEmail: null,
      direction: InquiryDirection.INBOUND,
      channel: InquiryChannel.EMAIL,
      messageType: InquiryMessageType.CUSTOMER,
      authorName: inquiry.name,
      subjectLine: null,
    };

    return {
      messages: [
        initialMessage,
        ...messages.map((message) => ({
          id: message.id,
          type: this.timelineType(message),
          content: message.bodyText,
          createdAt: message.createdAt,
          fromEmail: message.fromEmail,
          toEmail: message.toEmail,
          direction: message.direction,
          channel: message.channel,
          messageType: message.messageType,
          authorName: message.createdBy?.fullName ?? '',
          subjectLine: message.subjectLine,
        })),
      ],
    };
  }

  async listInquiryNotes(organizationId: string, inquiryId: string) {
    await this.requireInquiry(organizationId, inquiryId);

    const notes = await this.prisma.inquiryNote.findMany({
      where: { inquiryId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    return notes.map((note) => ({
      id: note.id,
      bodyText: note.bodyText,
      content: note.bodyText,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      authorUserId: note.authorUserId,
      authorName: note.author?.fullName ?? '',
    }));
  }

  async createInquiryNote(
    organizationId: string,
    inquiryId: string,
    dto: CreateInquiryNoteDto,
    actorUserId: string,
  ) {
    await this.requireInquiry(organizationId, inquiryId);
    const bodyText = dto.bodyText.trim();
    const now = new Date();

    const note = await this.prisma.inquiryNote.create({
      data: {
        inquiryId,
        authorUserId: actorUserId,
        bodyText,
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data: { lastActivityAt: now },
    });

    await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.SYSTEM,
        channel: InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.NOTE,
        bodyText: 'Internal note added.',
        createdByUserId: actorUserId,
      },
    });

    return {
      id: note.id,
      bodyText: note.bodyText,
      content: note.bodyText,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      authorUserId: note.authorUserId,
      authorName: note.author?.fullName ?? '',
    };
  }

  async replyToInquiry(
    organizationId: string,
    inquiryId: string,
    dto: CreateInquiryReplyDto,
    actorUserId: string,
  ) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    const bodyText = dto.bodyText.trim();
    const now = new Date();

    const message = await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.OUTBOUND,
        channel: inquiry.mailboxId ? InquiryChannel.EMAIL : InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.OPERATOR_REPLY,
        bodyText,
        fromEmail: inquiry.mailboxId ? undefined : null,
        toEmail: inquiry.email,
        mailboxId: inquiry.mailboxId,
        externalThreadId: inquiry.externalThreadId,
        createdByUserId: actorUserId,
        sentAt: dto.sendEmail ? now : null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const nextStatus =
      inquiry.status === PublicInquiryStatus.CLOSED || inquiry.status === PublicInquiryStatus.SPAM
        ? PublicInquiryStatus.IN_PROGRESS
        : inquiry.status === PublicInquiryStatus.NEW
          ? PublicInquiryStatus.IN_PROGRESS
          : inquiry.status;

    await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data: {
        status: nextStatus,
        acknowledgedAt: inquiry.acknowledgedAt ?? now,
        firstRespondedAt: inquiry.firstRespondedAt ?? now,
        lastOutboundAt: now,
        lastActivityAt: now,
        closedAt: null,
        isEscalated: false,
        escalatedAt: null,
      },
    });

    return {
      id: message.id,
      type: this.timelineType(message),
      content: message.bodyText,
      bodyText: message.bodyText,
      createdAt: message.createdAt,
      direction: message.direction,
      channel: message.channel,
      messageType: message.messageType,
      authorName: message.createdBy?.fullName ?? '',
      sendEmail: dto.sendEmail ?? false,
      emailBackflowReady: Boolean(inquiry.mailboxId),
      emailSent: false,
    };
  }

  private async inquirySummary() {
    const [
      newCount,
      acknowledgedCount,
      inProgressCount,
      closedCount,
      spamCount,
      escalatedCount,
    ] = await Promise.all([
      this.prisma.publicInquiry.count({ where: { status: PublicInquiryStatus.NEW } }),
      this.prisma.publicInquiry.count({
        where: { status: PublicInquiryStatus.ACKNOWLEDGED },
      }),
      this.prisma.publicInquiry.count({
        where: { status: PublicInquiryStatus.IN_PROGRESS },
      }),
      this.prisma.publicInquiry.count({ where: { status: PublicInquiryStatus.CLOSED } }),
      this.prisma.publicInquiry.count({ where: { status: PublicInquiryStatus.SPAM } }),
      this.prisma.publicInquiry.count({ where: { isEscalated: true } }),
    ]);

    return {
      totalOpen: newCount + acknowledgedCount + inProgressCount,
      new: newCount,
      acknowledged: acknowledgedCount,
      inProgress: inProgressCount,
      closed: closedCount,
      spam: spamCount,
      escalated: escalatedCount,
    };
  }

  private async requireInquiry(organizationId: string, inquiryId: string) {
    void organizationId;
    const inquiry = await this.prisma.publicInquiry.findUnique({
      where: { id: inquiryId },
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }

    return inquiry;
  }

  private parseStatus(status?: string) {
    const value = status?.trim().toUpperCase();
    if (!value) return undefined;
    const allowed = new Set<string>(Object.values(PublicInquiryStatusDto));
    return allowed.has(value) ? (value as PublicInquiryStatus) : undefined;
  }

  private humanizeInquiryType(value: string) {
    return value
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  private humanizeStatus(value: string) {
    return value
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  private timelineType(message: {
    direction: InquiryDirection;
    messageType: InquiryMessageType;
  }) {
    if (message.messageType === InquiryMessageType.OPERATOR_REPLY) return 'OPERATOR';
    if (message.direction === InquiryDirection.SYSTEM) return 'SYSTEM';
    return 'USER';
  }
}
