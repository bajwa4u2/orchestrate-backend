import { Injectable } from '@nestjs/common';
import {
  AgreementStatus,
  CampaignStatus,
  InvoiceStatus,
  JobStatus,
  JobType,
  LeadStatus,
  MessageStatus,
  Prisma,
  ReplyIntent,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  AiAuthorityEntityRef,
  AiAuthorityScope,
  AiRealitySnapshot,
} from '../contracts/ai-authority.contract';

@Injectable()
export class AiRealitySnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async build(input: {
    scope: AiAuthorityScope;
    entity: AiAuthorityEntityRef;
  }): Promise<AiRealitySnapshot> {
    const warnings: string[] = [];
    const entity = await this.resolveEntity(input.entity, warnings);

    const [client, campaign, lead, reply, meeting] = await Promise.all([
      entity.clientId ? this.snapshotClient(entity.clientId, warnings) : null,
      entity.campaignId ? this.snapshotCampaign(entity.campaignId, warnings) : null,
      entity.leadId ? this.snapshotLead(entity.leadId, warnings) : null,
      entity.replyId ? this.snapshotReply(entity.replyId, warnings) : null,
      entity.meetingId ? this.snapshotMeeting(entity.meetingId, warnings) : null,
    ]);

    const clientId = entity.clientId ?? this.readString(client?.id) ?? null;
    const campaignId = entity.campaignId ?? this.readString(campaign?.id) ?? null;
    const leadId = entity.leadId ?? this.readString(lead?.id) ?? null;

    const [billing, agreements, invoices, jobs, workflows, activity, support, providers, system] =
      await Promise.all([
        clientId ? this.snapshotBilling(clientId, warnings) : null,
        clientId ? this.snapshotAgreements(clientId, warnings) : null,
        clientId ? this.snapshotInvoices(clientId, warnings) : null,
        this.snapshotJobs({ clientId, campaignId, leadId, jobId: entity.jobId }, warnings),
        this.snapshotWorkflows({ clientId, campaignId, workflowRunId: entity.workflowRunId }, warnings),
        this.snapshotActivity({ clientId, campaignId }, warnings),
        clientId ? this.snapshotSupport(clientId, warnings) : null,
        clientId ? this.snapshotProviders(clientId, campaignId, warnings) : null,
        this.snapshotSystem(warnings),
      ]);

    return {
      snapshotVersion: '2026-04-ai-authority-v1',
      generatedAt: new Date().toISOString(),
      scope: input.scope,
      entity,
      client,
      campaign,
      lead,
      reply,
      meeting,
      billing,
      agreements,
      invoices,
      jobs,
      workflows,
      activity,
      support,
      providers,
      system,
      warnings,
    };
  }

  private async resolveEntity(entity: AiAuthorityEntityRef, warnings: string[]) {
    const resolved: AiAuthorityEntityRef = { ...entity };

    if (resolved.leadId && (!resolved.clientId || !resolved.campaignId || !resolved.organizationId)) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: resolved.leadId },
        select: { organizationId: true, clientId: true, campaignId: true },
      });
      if (lead) {
        resolved.organizationId ??= lead.organizationId;
        resolved.clientId ??= lead.clientId;
        resolved.campaignId ??= lead.campaignId;
      } else {
        warnings.push(`Lead not found while resolving entity: ${resolved.leadId}`);
      }
    }

    if (resolved.replyId && (!resolved.leadId || !resolved.clientId || !resolved.campaignId || !resolved.organizationId)) {
      const reply = await this.prisma.reply.findUnique({
        where: { id: resolved.replyId },
        select: { organizationId: true, clientId: true, campaignId: true, leadId: true },
      });
      if (reply) {
        resolved.organizationId ??= reply.organizationId;
        resolved.clientId ??= reply.clientId;
        resolved.campaignId ??= reply.campaignId;
        resolved.leadId ??= reply.leadId;
      } else {
        warnings.push(`Reply not found while resolving entity: ${resolved.replyId}`);
      }
    }

    if (resolved.campaignId && (!resolved.clientId || !resolved.organizationId)) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: resolved.campaignId },
        select: { organizationId: true, clientId: true },
      });
      if (campaign) {
        resolved.organizationId ??= campaign.organizationId;
        resolved.clientId ??= campaign.clientId;
      } else {
        warnings.push(`Campaign not found while resolving entity: ${resolved.campaignId}`);
      }
    }

    if (resolved.clientId && !resolved.organizationId) {
      const client = await this.prisma.client.findUnique({
        where: { id: resolved.clientId },
        select: { organizationId: true },
      });
      if (client) {
        resolved.organizationId = client.organizationId;
      } else {
        warnings.push(`Client not found while resolving entity: ${resolved.clientId}`);
      }
    }

    return resolved;
  }

  private async snapshotClient(clientId: string, warnings: string[]) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        organizationId: true,
        legalName: true,
        displayName: true,
        status: true,
        industry: true,
        websiteUrl: true,
        bookingUrl: true,
        primaryTimezone: true,
        currencyCode: true,
        primaryEmail: true,
        billingEmail: true,
        legalEmail: true,
        opsEmail: true,
        country: true,
        area: true,
        selectedPlan: true,
        setupCompletedAt: true,
        outboundOffer: true,
        scopeJson: true,
        metadataJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!client) {
      warnings.push(`Client not found: ${clientId}`);
      return null;
    }

    const [campaignCounts, leadCounts, openJobs, recentActivity] = await Promise.all([
      this.prisma.campaign.groupBy({
        by: ['status'],
        where: { clientId },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { clientId },
        _count: { _all: true },
      }),
      this.prisma.job.count({
        where: {
          clientId,
          status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED] },
        },
      }),
      this.prisma.activityEvent.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { kind: true, subjectType: true, summary: true, createdAt: true },
      }),
    ]);

    return {
      ...this.serialize(client),
      health: {
        setupComplete: Boolean(client.setupCompletedAt),
        hasBookingUrl: Boolean(client.bookingUrl),
        hasPrimaryEmail: Boolean(client.primaryEmail),
        activeOrLead: ['ACTIVE', 'LEAD'].includes(String(client.status)),
      },
      counts: {
        campaignsByStatus: this.groupedCounts(campaignCounts),
        leadsByStatus: this.groupedCounts(leadCounts),
        activeJobs: openJobs,
      },
      recentActivity: this.serialize(recentActivity),
    };
  }

  private async snapshotCampaign(campaignId: string, warnings: string[]) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        workflowRunId: true,
        name: true,
        status: true,
        generationState: true,
        channel: true,
        objective: true,
        offerSummary: true,
        bookingUrlOverride: true,
        dailySendCap: true,
        startAt: true,
        endAt: true,
        metadataJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!campaign) {
      warnings.push(`Campaign not found: ${campaignId}`);
      return null;
    }

    const [leadCounts, messageCounts, replyCounts, jobCounts, sentToday] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { campaignId },
        _count: { _all: true },
      }),
      this.prisma.outreachMessage.groupBy({
        by: ['status'],
        where: { campaignId },
        _count: { _all: true },
      }),
      this.prisma.reply.groupBy({
        by: ['intent'],
        where: { campaignId },
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['type', 'status'],
        where: { campaignId },
        _count: { _all: true },
      }),
      this.prisma.outreachMessage.count({
        where: {
          campaignId,
          sentAt: { gte: this.startOfToday() },
        },
      }),
    ]);

    const activeWindow = this.isActiveWindow(campaign.startAt, campaign.endAt);

    return {
      ...this.serialize(campaign),
      health: {
        isActive: campaign.status === CampaignStatus.ACTIVE,
        isReady: [CampaignStatus.READY, CampaignStatus.ACTIVE].includes(
          campaign.status as 'READY' | 'ACTIVE',
        ),
        activeWindow,
        hasBookingPath: Boolean(campaign.bookingUrlOverride),
        dailySendCap: campaign.dailySendCap ?? 25,
        sentToday,
      },
      counts: {
        leadsByStatus: this.groupedCounts(leadCounts),
        messagesByStatus: this.groupedCounts(messageCounts),
        repliesByIntent: this.groupedCounts(replyCounts),
        jobsByTypeStatus: jobCounts.map((row) => ({
          type: row.type,
          status: row.status,
          count: row._count._all,
        })),
      },
    };
  }

  private async snapshotLead(leadId: string, warnings: string[]) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        account: {
          select: {
            id: true,
            companyName: true,
            domain: true,
            industry: true,
            city: true,
            region: true,
            countryCode: true,
            websiteUrl: true,
            qualificationStatus: true,
            enrichmentJson: true,
          },
        },
        contact: {
          select: {
            id: true,
            fullName: true,
            firstName: true,
            lastName: true,
            title: true,
            email: true,
            emailStatus: true,
            linkedinUrl: true,
            timezone: true,
            city: true,
            region: true,
            countryCode: true,
            qualificationStatus: true,
            enrichmentJson: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            offerSummary: true,
            bookingUrlOverride: true,
            dailySendCap: true,
          },
        },
        client: {
          select: { id: true, displayName: true, legalName: true, bookingUrl: true, status: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            direction: true,
            status: true,
            lifecycle: true,
            subjectLine: true,
            sentAt: true,
            failedAt: true,
            errorMessage: true,
            metadataJson: true,
            createdAt: true,
          },
        },
        replies: {
          orderBy: { receivedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            intent: true,
            confidence: true,
            fromEmail: true,
            subjectLine: true,
            bodyText: true,
            receivedAt: true,
            requiresHumanReview: true,
            handledAt: true,
            metadataJson: true,
          },
        },
        meetings: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, status: true, title: true, bookingUrl: true, scheduledAt: true, createdAt: true },
        },
      },
    });

    if (!lead) {
      warnings.push(`Lead not found: ${leadId}`);
      return null;
    }

    return {
      ...this.serialize(lead),
      health: {
        hasEmail: Boolean(lead.contact?.email),
        emailStatus: lead.contact?.emailStatus ?? null,
        hasPendingReply: lead.replies.some((reply) => !reply.handledAt || reply.requiresHumanReview),
        hasInterestedReply: lead.replies.some((reply) =>
          [ReplyIntent.INTERESTED, ReplyIntent.REFERRAL].includes(
            reply.intent as 'INTERESTED' | 'REFERRAL',
          ),
        ),
        alreadyContacted: Boolean(lead.firstContactAt || lead.lastContactAt || lead.messages.some((m) => m.sentAt)),
        latestReplyIntent: lead.replies[0]?.intent ?? null,
      },
    };
  }

  private async snapshotReply(replyId: string, warnings: string[]) {
    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      include: {
        lead: { include: { contact: true, account: true } },
        meeting: true,
      },
    });
    if (!reply) {
      warnings.push(`Reply not found: ${replyId}`);
      return null;
    }
    return this.serialize(reply);
  }

  private async snapshotMeeting(meetingId: string, warnings: string[]) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) {
      warnings.push(`Meeting not found: ${meetingId}`);
      return null;
    }
    return this.serialize(meeting);
  }

  private async snapshotBilling(clientId: string, warnings: string[]) {
    const [subscriptions, openInvoices, recentPayments] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { clientId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          amountCents: true,
          currencyCode: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          canceledAt: true,
          metadataJson: true,
          updatedAt: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          clientId,
          status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.ISSUED, InvoiceStatus.SENT, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalCents: true,
          balanceDueCents: true,
          dueAt: true,
          issuedAt: true,
          lastSentAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, amountCents: true, currencyCode: true, createdAt: true },
      }).catch((error) => {
        warnings.push(`Payment snapshot unavailable: ${this.errorMessage(error)}`);
        return [];
      }),
    ]);

    const activeSubscription = subscriptions.find((subscription) => subscription.status === SubscriptionStatus.ACTIVE);
    const trialingSubscription = subscriptions.find((subscription) => subscription.status === SubscriptionStatus.TRIALING);

    return {
      subscriptions: this.serialize(subscriptions),
      openInvoices: this.serialize(openInvoices),
      recentPayments: this.serialize(recentPayments),
      health: {
        hasActiveSubscription: Boolean(activeSubscription),
        hasTrialingSubscription: Boolean(trialingSubscription),
        hasRevenueAccess: Boolean(activeSubscription || trialingSubscription),
        openBalanceCents: openInvoices.reduce((sum, invoice) => sum + (invoice.balanceDueCents ?? 0), 0),
        overdueInvoiceCount: openInvoices.filter((invoice) => invoice.status === InvoiceStatus.OVERDUE).length,
      },
    };
  }

  private async snapshotAgreements(clientId: string, warnings: string[]) {
    const agreements: Array<{
      id: string;
      status: AgreementStatus;
      title: string;
      effectiveStartAt: Date | null;
      effectiveEndAt: Date | null;
      acceptedAt: Date | null;
      metadataJson: Prisma.JsonValue | null;
      updatedAt: Date;
    }> = await this.prisma.serviceAgreement.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        title: true,
        effectiveStartAt: true,
        effectiveEndAt: true,
        acceptedAt: true,
        metadataJson: true,
        updatedAt: true,
      },
    }).catch((error) => {
      warnings.push(`Agreement snapshot unavailable: ${this.errorMessage(error)}`);
      return [];
    });

    return {
      recent: this.serialize(agreements),
      health: {
        hasAcceptedAgreement: agreements.some((agreement) =>
          [AgreementStatus.ACCEPTED, AgreementStatus.ACTIVE].includes(
            agreement.status as 'ACCEPTED' | 'ACTIVE',
          ),
        ),
        hasIssuedAgreement: agreements.some((agreement) => agreement.status === AgreementStatus.ISSUED),
      },
    };
  }

  private async snapshotInvoices(clientId: string, warnings: string[]) {
    const invoices: Array<{
      id: string;
      invoiceNumber: string;
      status: InvoiceStatus;
      totalCents: number;
      amountPaidCents: number;
      balanceDueCents: number;
      dueAt: Date | null;
      issuedAt: Date | null;
      paidAt: Date | null;
      createdAt: Date;
    }> = await this.prisma.invoice.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalCents: true,
        amountPaidCents: true,
        balanceDueCents: true,
        dueAt: true,
        issuedAt: true,
        paidAt: true,
        createdAt: true,
      },
    }).catch((error) => {
      warnings.push(`Invoice snapshot unavailable: ${this.errorMessage(error)}`);
      return [];
    });

    return {
      recent: this.serialize(invoices),
      health: {
        unpaidCount: invoices.filter((invoice) => invoice.balanceDueCents > 0).length,
        paidCount: invoices.filter((invoice) => invoice.status === InvoiceStatus.PAID).length,
      },
    };
  }

  private async snapshotJobs(
    input: { clientId?: string | null; campaignId?: string | null; leadId?: string | null; jobId?: string | null },
    warnings: string[],
  ) {
    const payloadLeadFilter = input.leadId ? { payloadJson: { path: ['leadId'], equals: input.leadId } } : undefined;
    const where: Prisma.JobWhereInput = input.jobId
      ? { id: input.jobId }
      : {
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(input.campaignId ? { campaignId: input.campaignId } : {}),
          ...(payloadLeadFilter ?? {}),
        };

    const [recent, activeCounts, failedRecent] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          type: true,
          status: true,
          queueName: true,
          dedupeKey: true,
          scheduledFor: true,
          attemptCount: true,
          maxAttempts: true,
          lastError: true,
          payloadJson: true,
          resultJson: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.job.groupBy({
        by: ['type', 'status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.job.findMany({
        where: { ...where, status: JobStatus.FAILED },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, type: true, lastError: true, updatedAt: true, payloadJson: true },
      }),
    ]).catch((error) => {
      warnings.push(`Job snapshot unavailable: ${this.errorMessage(error)}`);
      return [[], [], []] as const;
    });

    return {
      recent: this.serialize(recent),
      failedRecent: this.serialize(failedRecent),
      countsByTypeStatus: activeCounts.map((row) => ({ type: row.type, status: row.status, count: row._count._all })),
    };
  }

  private async snapshotWorkflows(
    input: { clientId?: string | null; campaignId?: string | null; workflowRunId?: string | null },
    warnings: string[],
  ) {
    const workflows = await this.prisma.workflowRun.findMany({
      where: input.workflowRunId
        ? { id: input.workflowRunId }
        : {
            ...(input.clientId ? { clientId: input.clientId } : {}),
            ...(input.campaignId ? { campaignId: input.campaignId } : {}),
          },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        lane: true,
        type: true,
        status: true,
        title: true,
        inputJson: true,
        contextJson: true,
        resultJson: true,
        errorJson: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
        createdAt: true,
      },
    }).catch((error) => {
      warnings.push(`Workflow snapshot unavailable: ${this.errorMessage(error)}`);
      return [];
    });

    return { recent: this.serialize(workflows) };
  }

  private async snapshotActivity(
    input: { clientId?: string | null; campaignId?: string | null },
    warnings: string[],
  ) {
    const where: Prisma.ActivityEventWhereInput = {
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    };
    const events = await this.prisma.activityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        kind: true,
        visibility: true,
        subjectType: true,
        subjectId: true,
        summary: true,
        metadataJson: true,
        createdAt: true,
      },
    }).catch((error) => {
      warnings.push(`Activity snapshot unavailable: ${this.errorMessage(error)}`);
      return [];
    });
    return { recent: this.serialize(events) };
  }

  private async snapshotSupport(clientId: string, warnings: string[]) {
    const inquiries: Array<{
      id: string;
      status: string;
      priority: string;
      message: string;
      createdAt: Date;
      updatedAt: Date;
    }> = await this.prisma.publicInquiry.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        inquiryType: true,
        status: true,
        category: true,
        intent: true,
        priority: true,
        message: true,
        createdAt: true,
        updatedAt: true,
      },
    }).catch((error) => {
      warnings.push(`Support snapshot unavailable: ${this.errorMessage(error)}`);
      return [];
    });

    return {
      recentInquiries: this.serialize(inquiries),
      health: {
        openInquiryCount: inquiries.filter((item) => !['CLOSED', 'SPAM'].includes(String(item.status))).length,
        highPriorityCount: inquiries.filter((item) => String(item.priority) === 'HIGH').length,
      },
    };
  }

  private async snapshotProviders(clientId: string, campaignId: string | null | undefined, warnings: string[]) {
    const leadSources = await this.prisma.leadSource.findMany({
      where: {
        clientId,
        ...(campaignId ? { campaignId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        type: true,
        name: true,
        source: true,
        sourceRef: true,
        configJson: true,
        importedAt: true,
        createdAt: true,
      },
    }).catch((error) => {
      warnings.push(`Provider snapshot unavailable: ${this.errorMessage(error)}`);
      return [];
    });

    return { recentLeadSources: this.serialize(leadSources) };
  }

  private snapshotSystem(warnings: string[]) {
    const openAiConfigured = Boolean(process.env.OPENAI_API_KEY);
    const dispatchEnabled = (process.env.EXECUTION_DISPATCH_ENABLED?.trim() || '').toLowerCase() === 'true';
    const continuityEnabled = (process.env.CAMPAIGN_CONTINUITY_ENABLED?.trim() || 'true').toLowerCase() !== 'false';

    if (!openAiConfigured) warnings.push('OPENAI_API_KEY is not configured. AI authority calls will fail.');

    return {
      env: {
        openAiConfigured,
        primaryModel: process.env.OPENAI_MODEL_PRIMARY || 'gpt-4o',
        fastModel: process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini',
        dispatchEnabled,
        continuityEnabled,
      },
      runtime: {
        nodeEnv: process.env.NODE_ENV || 'development',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private groupedCounts(rows: Array<Record<string, any>>) {
    return rows.reduce<Record<string, number>>((acc, row) => {
      const key = String(row.status ?? row.intent ?? row.type ?? 'UNKNOWN');
      acc[key] = Number(row._count?._all ?? 0);
      return acc;
    }, {});
  }

  private startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private isActiveWindow(startAt: Date | null, endAt: Date | null) {
    const now = Date.now();
    if (startAt && startAt.getTime() > now) return false;
    if (endAt && endAt.getTime() < now) return false;
    return true;
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => {
        if (typeof item === 'bigint') return item.toString();
        if (item instanceof Prisma.Decimal) return Number(item.toString());
        return item;
      }),
    );
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
