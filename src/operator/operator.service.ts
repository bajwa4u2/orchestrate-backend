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
  AlertStatus,
  JobStatus,
  MailboxHealthStatus,
  CampaignStatus,
  MeetingStatus,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { ControlService } from '../control/control.service';
import { PrismaService } from '../database/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EmailsService } from '../emails/emails.service';
import { DeliverabilityService } from '../deliverability/deliverability.service';
import { ExecutionService } from '../execution/execution.service';
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
    private readonly clientsService: ClientsService,
    private readonly campaignsService: CampaignsService,
    private readonly emailsService: EmailsService,
    private readonly deliverabilityService: DeliverabilityService,
    private readonly executionService: ExecutionService,
  ) {}


commandOverview() {
  return this.controlService.overview();
}

async commandWorkspace() {
  const [
    overview,
    recentCampaigns,
    activeCampaignCount,
    pausedCampaignCount,
    draftCampaignCount,
    recentClients,
    recentMessages,
    recentReplies,
    openAlerts,
    failedJobs,
    queuedJobs,
    recentMailboxes,
    inquiryBundle,
    meetingsBookedToday,
  ] = await Promise.all([
    this.controlService.overview(),
    this.prisma.campaign.findMany({
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      include: {
        client: { select: { id: true, displayName: true, legalName: true } },
      },
    }),
    this.prisma.campaign.count({ where: { status: CampaignStatus.ACTIVE, archivedAt: null } }),
    this.prisma.campaign.count({ where: { status: CampaignStatus.PAUSED, archivedAt: null } }),
    this.prisma.campaign.count({ where: { status: CampaignStatus.DRAFT, archivedAt: null } }),
    this.prisma.client.findMany({
      where: { archivedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      include: {
        organization: { select: { id: true, displayName: true, legalName: true } },
      },
    }),
    this.prisma.outreachMessage.findMany({
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      include: {
        client: { select: { id: true, displayName: true, legalName: true } },
        campaign: { select: { id: true, name: true, status: true } },
        lead: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        mailbox: { select: { id: true, emailAddress: true, label: true, healthStatus: true } },
      },
    }),
    this.prisma.reply.findMany({
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      include: {
        client: { select: { id: true, displayName: true, legalName: true } },
        campaign: { select: { id: true, name: true, status: true } },
        lead: { select: { id: true, firstName: true, lastName: true, companyName: true } },
        meeting: { select: { id: true, status: true, scheduledAt: true } },
      },
    }),
    this.prisma.alert.findMany({
      where: { status: AlertStatus.OPEN },
      orderBy: [{ createdAt: 'desc' }],
      take: 12,
      include: {
        client: { select: { id: true, displayName: true, legalName: true } },
        campaign: { select: { id: true, name: true, status: true } },
      },
    }),
    this.prisma.job.findMany({
      where: { status: JobStatus.FAILED },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      include: {
        client: { select: { id: true, displayName: true, legalName: true } },
        campaign: { select: { id: true, name: true, status: true } },
      },
    }),
    this.prisma.job.findMany({
      where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED] } },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      take: 12,
      include: {
        client: { select: { id: true, displayName: true, legalName: true } },
        campaign: { select: { id: true, name: true, status: true } },
      },
    }),
    this.prisma.mailbox.findMany({
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      include: {
        client: { select: { id: true, displayName: true, legalName: true } },
      },
    }),
    this.listPublicInquiries(undefined, { limit: '12' }),
    this.prisma.meeting.count({
      where: {
        status: MeetingStatus.BOOKED,
        scheduledAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    }),
  ]);

  const healthyMailboxes = recentMailboxes.filter((mailbox) => {
    return ![MailboxHealthStatus.DEGRADED, MailboxHealthStatus.CRITICAL].includes(mailbox.healthStatus);
  }).length;
  const degradedMailboxes = recentMailboxes.filter((mailbox) => {
    return [MailboxHealthStatus.DEGRADED, MailboxHealthStatus.CRITICAL].includes(mailbox.healthStatus);
  }).length;

  const attention = this.buildCommandAttention({
    alerts: openAlerts as Array<Record<string, unknown>>,
    emailDispatches: recentMessages as Array<Record<string, unknown>>,
    campaigns: recentCampaigns as Array<Record<string, unknown>>,
    inquiries: Array.isArray(inquiryBundle?.items) ? (inquiryBundle.items as Array<Record<string, unknown>>) : [],
  });

  return {
    title: 'Operator command',
    subtitle:
      'Live system state across clients, campaigns, outreach, replies, and pressure that needs intervention.',
    pulse: {
      totals: overview?.totals ?? {},
      today: {
        ...(overview?.today ?? {}),
        booked: meetingsBookedToday,
      },
      execution: {
        ...(overview?.execution ?? {}),
        queuedJobs: queuedJobs.length,
        failedJobs: failedJobs.length,
      },
      deliverability: {
        ...(overview?.deliverability ?? {}),
        healthyMailboxes,
        degradedMailboxes,
      },
      campaigns: {
        active: activeCampaignCount,
        paused: pausedCampaignCount,
        draft: draftCampaignCount,
      },
    },
    attention,
    execution: {
      queuedJobs: queuedJobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        scheduledFor: job.scheduledFor,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        clientName: job.client?.displayName ?? job.client?.legalName ?? '',
        campaignName: job.campaign?.name ?? '',
      })),
      failedJobs: failedJobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        error: job.lastError ?? '',
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        clientName: job.client?.displayName ?? job.client?.legalName ?? '',
        campaignName: job.campaign?.name ?? '',
      })),
      emailDispatches: recentMessages.map((message) => ({
        id: message.id,
        status: message.status,
        lifecycle: message.lifecycle,
        createdAt: message.createdAt,
        sentAt: message.sentAt,
        subjectLine: message.subjectLine,
        toEmail: message.toEmail,
        clientName: message.client?.displayName ?? message.client?.legalName ?? '',
        campaignName: message.campaign?.name ?? '',
        leadId: message.leadId,
        leadName: [message.lead?.firstName, message.lead?.lastName].where((part) => (part ?? '').trim().isNotEmpty).join(' ').trim(),
        leadCompany: message.lead?.companyName ?? '',
        mailboxId: message.mailboxId,
        mailboxEmail: message.mailbox?.emailAddress ?? '',
      })),
    },
    outreach: {
      campaigns: recentCampaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        generationState: campaign.generationState,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        clientId: campaign.clientId,
        clientName: campaign.client?.displayName ?? campaign.client?.legalName ?? '',
      })),
    },
    conversations: {
      replies: recentReplies.map((reply) => ({
        id: reply.id,
        status: reply.status,
        intent: reply.intent,
        receivedAt: reply.receivedAt,
        fromEmail: reply.fromEmail,
        bodyText: reply.bodyText,
        clientName: reply.client?.displayName ?? reply.client?.legalName ?? '',
        campaignName: reply.campaign?.name ?? '',
        leadName: [reply.lead?.firstName, reply.lead?.lastName].where((part) => (part ?? '').trim().isNotEmpty).join(' ').trim(),
        leadCompany: reply.lead?.companyName ?? '',
        meetingStatus: reply.meeting?.status ?? null,
        meetingScheduledAt: reply.meeting?.scheduledAt ?? null,
      })),
      inquiries: inquiryBundle?.items ?? [],
      summary: inquiryBundle?.summary ?? null,
    },
    clients: {
      items: recentClients.map((client) => ({
        id: client.id,
        displayName: client.displayName,
        legalName: client.legalName,
        status: client.status,
        industry: client.industry,
        websiteUrl: client.websiteUrl,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
        organizationName: client.organization.displayName,
      })),
    },
    health: {
      alerts: openAlerts.map((alert) => ({
        id: alert.id,
        title: alert.title,
        severity: alert.severity,
        status: alert.status,
        category: alert.category,
        bodyText: alert.bodyText,
        createdAt: alert.createdAt,
        clientName: alert.client?.displayName ?? alert.client?.legalName ?? '',
        campaignName: alert.campaign?.name ?? '',
      })),
      summary: {
        open: openAlerts.length,
        critical: openAlerts.filter((alert) => alert.severity === 'CRITICAL').length,
        healthyMailboxes,
        degradedMailboxes,
      },
      mailboxes: recentMailboxes.map((mailbox) => ({
        id: mailbox.id,
        label: mailbox.label,
        emailAddress: mailbox.emailAddress,
        provider: mailbox.provider,
        status: mailbox.status,
        healthStatus: mailbox.healthStatus,
        warmupStatus: mailbox.warmupStatus,
        dailySendCap: mailbox.dailySendCap,
        updatedAt: mailbox.updatedAt,
        clientName: mailbox.client?.displayName ?? mailbox.client?.legalName ?? '',
      })),
    },
  };
}

revenueOverview(organizationId: string) {
  return this.billingService.overview(organizationId);
}

async recordsOverview() {
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
    outreachMessages,
    jobs,
    mailboxes,
  ] = await Promise.all([
    this.prisma.client.count(),
    this.prisma.campaign.count(),
    this.prisma.lead.count(),
    this.prisma.reply.count(),
    this.prisma.meeting.count(),
    this.prisma.serviceAgreement.count(),
    this.prisma.statement.count(),
    this.prisma.reminderArtifact.count(),
    this.prisma.template.count(),
    this.prisma.alert.count(),
    this.prisma.documentDispatch.count({ where: { deliveryChannel: 'EMAIL' } }),
    this.prisma.outreachMessage.count(),
    this.prisma.job.count(),
    this.prisma.mailbox.count(),
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
    outreachMessages,
    jobs,
    mailboxes,
  };
}

async activateCampaignGlobal(campaignId: string) {
  const campaign = await this.prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, organizationId: true },
  });

  if (!campaign) {
    throw new NotFoundException('Campaign not found');
  }

  return this.campaignsService.activateCampaign({
    campaignId: campaign.id,
    organizationId: campaign.organizationId,
  });
}

async resolveAlertGlobal(alertId: string, userId?: string) {
  const alert = await this.prisma.alert.findUnique({
    where: { id: alertId },
    select: { id: true, status: true },
  });

  if (!alert) {
    throw new NotFoundException('Alert not found');
  }

  if (alert.status === AlertStatus.RESOLVED) {
    return { ok: true, status: AlertStatus.RESOLVED, id: alert.id };
  }

  return this.prisma.alert.update({
    where: { id: alert.id },
    data: {
      status: AlertStatus.RESOLVED,
      resolvedAt: new Date(),
      resolvedById: userId,
    },
  });
}

async dispatchDueJobsGlobal(limit?: number) {
  const parsed = Number.isFinite(limit as number) ? Number(limit) : Number.parseInt(String(limit ?? ''), 10);
  const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
  return this.executionService.dispatchDueJobs({ limit: safeLimit });
}

async listPublicInquiries(
  organizationId?: string,
  filters: { limit?: string; status?: string; q?: string } = {},
) {
  void organizationId;
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

  private buildCommandAttention(input: {
    alerts: Array<Record<string, unknown>>;
    emailDispatches: Array<Record<string, unknown>>;
    campaigns: Array<Record<string, unknown>>;
    inquiries: Array<Record<string, unknown>>;
  }) {
    const items: Array<Record<string, unknown>> = [];

    for (const alert of input.alerts) {
      const resolved = alert['resolvedAt'] ?? alert['closedAt'] ?? null;
      if (resolved) continue;
      items.push({
        kind: 'alert',
        id: alert['id'] ?? null,
        title: this.safeString(alert['title']) || 'System alert',
        severity: this.safeString(alert['severity']) || 'warning',
      });
    }

    for (const dispatch of input.emailDispatches) {
      const status = this.safeString(dispatch['status']);
      if (!['FAILED', 'BOUNCED', 'BLOCKED'].includes(status)) continue;
      items.push({
        kind: 'email_dispatch',
        id: dispatch['id'] ?? null,
        title: 'Email dispatch needs review',
        severity: status === 'FAILED' ? 'critical' : 'warning',
        status,
      });
    }

    for (const campaign of input.campaigns) {
      const status = this.safeString(campaign['status']);
      if (status === 'ACTIVE') continue;
      items.push({
        kind: 'campaign',
        id: campaign['id'] ?? null,
        title: 'Campaign not active',
        severity: 'info',
        status,
      });
    }

    for (const inquiry of input.inquiries) {
      const status = this.safeString(inquiry['status']);
      if (status === 'CLOSED') continue;
      items.push({
        kind: 'inquiry',
        id: inquiry['id'] ?? null,
        title: this.safeString(inquiry['company'])
          || this.safeString(inquiry['name'])
          || 'Inquiry waiting',
        severity: status === 'ESCALATED' ? 'critical' : 'info',
        status,
      });
    }

    return items.slice(0, 20);
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

  private safeString(value: unknown) {
    return typeof value === 'string' ? value : String(value ?? '');
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
