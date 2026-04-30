import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CommunicationType,
  ContactConsentStatus,
  ImportBatchStatus,
  JobStatus,
  JobType,
  MailboxConnectionState,
  MailboxHealthStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { buildExecutionReadSurface } from '../common/utils/execution-read-surface';

@Injectable()
export class ClientPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
  ) {}

  async overview(organizationId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: { subscriptions: true, campaigns: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found in active organization');
    }

    const [
      billing,
      replies,
      meetings,
      notifications,
      emailDispatches,
      totalLeads,
      totalContacts,
      totalChannels,
      sendableLeads,
      mailboxSummary,
      importSummary,
      executionSummary,
      consentSummary,
    ] = await Promise.all([
      this.safeValue(() => this.billingService.overview(organizationId, clientId), null),
      this.safeValue(() => this.prisma.reply.count({ where: { organizationId, clientId } }), 0),
      this.safeValue(() => this.prisma.meeting.count({ where: { organizationId, clientId } }), 0),
      this.safeValue(() => this.prisma.alert.count({
        where: { organizationId, clientId, status: 'OPEN' },
      }), 0),
      this.safeValue(() => this.prisma.documentDispatch.count({
        where: {
          organizationId,
          clientId,
          deliveryChannel: 'EMAIL',
        },
      }), 0),
      this.safeValue(() => this.prisma.lead.count({ where: { organizationId, clientId } }), 0),
      this.safeValue(() => this.prisma.contact.count({ where: { organizationId, clientId } }), 0),
      this.safeValue(() => this.prisma.contactChannel.count({ where: { organizationId, clientId } }), 0),
      this.safeValue(() => this.prisma.lead.count({
        where: {
          organizationId,
          clientId,
          status: { not: 'SUPPRESSED' },
        },
      }), 0),
      this.safeValue(() => this.getMailboxSummary(organizationId, clientId), this.emptyMailboxSummary()),
      this.safeValue(() => this.getImportSummary(organizationId, clientId), this.emptyImportSummary()),
      this.safeValue(() => this.getExecutionSummary(organizationId, clientId), null),
      this.safeValue(() => this.getConsentSummary(organizationId, clientId), null),
    ]);

    return {
      client,
      billing,
      activity: {
        leadCount: totalLeads,
        contactCount: totalContacts,
        channelCount: totalChannels,
        sendableLeadCount: sendableLeads,
        replies,
        meetings,
      },
      communications: {
        openNotifications: notifications,
        emailDispatches,
        portalUrl: `${process.env.CLIENT_PORTAL_BASE_URL ?? 'https://orchestrateops.com/client'}?clientId=${clientId}`,
      },
      mailbox: mailboxSummary,
      imports: importSummary,
      execution: executionSummary,
      permissions: consentSummary,
    };
  }

  async leads(organizationId: string, clientId: string) {
    const leads = await this.prisma.lead.findMany({
      where: { organizationId, clientId },
      select: {
        id: true,
        status: true,
        qualificationState: true,
        source: true,
        accountId: true,
        contactId: true,
        campaignId: true,
        leadSourceId: true,
        metadataJson: true,
        suppressionReason: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const contactIds = Array.from(new Set(leads.map((lead) => lead.contactId).filter(Boolean))) as string[];
    const accountIds = Array.from(new Set(leads.map((lead) => lead.accountId).filter(Boolean))) as string[];
    const campaignIds = Array.from(new Set(leads.map((lead) => lead.campaignId).filter(Boolean))) as string[];
    const leadSourceIds = Array.from(new Set(leads.map((lead) => lead.leadSourceId).filter(Boolean))) as string[];

    const [contacts, accounts, campaigns, leadSources] = await Promise.all([
      contactIds.length
        ? this.safeValue(() => this.prisma.contact.findMany({
            where: { organizationId, clientId, id: { in: contactIds } },
            select: {
              id: true,
              fullName: true,
              title: true,
              email: true,
              phone: true,
              city: true,
              region: true,
              countryCode: true,
            },
          }), [])
        : [],
      accountIds.length
        ? this.safeValue(() => this.prisma.account.findMany({
            where: { organizationId, clientId, id: { in: accountIds } },
            select: { id: true, companyName: true },
          }), [])
        : [],
      campaignIds.length
        ? this.safeValue(() => this.prisma.campaign.findMany({
            where: { organizationId, clientId, id: { in: campaignIds } },
            select: { id: true, name: true },
          }), [])
        : [],
      leadSourceIds.length
        ? this.safeValue(() => this.prisma.leadSource.findMany({
            where: { organizationId, clientId, id: { in: leadSourceIds } },
            select: { id: true, name: true },
          }), [])
        : [],
    ]);

    const contactsById = new Map((contacts as any[]).map((item) => [item.id, item]));
    const accountsById = new Map((accounts as any[]).map((item) => [item.id, item]));
    const campaignsById = new Map((campaigns as any[]).map((item) => [item.id, item]));
    const leadSourcesById = new Map((leadSources as any[]).map((item) => [item.id, item]));

    return leads.map((lead) => {
      const contact = lead.contactId ? contactsById.get(lead.contactId) : null;
      const account = lead.accountId ? accountsById.get(lead.accountId) : null;
      const campaign = lead.campaignId ? campaignsById.get(lead.campaignId) : null;
      const leadSource = lead.leadSourceId ? leadSourcesById.get(lead.leadSourceId) : null;

      const location = [contact?.city, contact?.region, contact?.countryCode]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(', ');

      return {
        id: lead.id,
        name: contact?.fullName ?? '',
        company: account?.companyName ?? '',
        title: contact?.title ?? '',
        email: contact?.email ?? '',
        phone: contact?.phone ?? '',
        location,
        campaign: campaign?.name ?? '',
        status: lead.status,
        qualificationState: lead.qualificationState,
        source: leadSource?.name ?? String(lead.source),
        suppressionReason: lead.suppressionReason ?? null,
        metadataJson: lead.metadataJson ?? null,
        createdAt: lead.createdAt,
      };
    });
  }

  invoices(organizationId: string, clientId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId, clientId },
      include: { lines: true, receipts: true, creditNotes: true },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  statements(organizationId: string, clientId: string) {
    return this.prisma.statement.findMany({
      where: { organizationId, clientId },
      include: {
        invoiceLinks: { include: { invoice: true } },
        paymentLinks: { include: { payment: true } },
      },
      orderBy: [{ periodEnd: 'desc' }],
    });
  }

  agreements(organizationId: string, clientId: string) {
    return this.prisma.serviceAgreement.findMany({
      where: { organizationId, clientId },
      include: { subscription: true },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  reminders(organizationId: string, clientId: string) {
    return this.prisma.reminderArtifact.findMany({
      where: { organizationId, clientId },
      include: { invoice: true, agreement: true },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  notifications(organizationId: string, clientId: string) {
    return this.prisma.alert.findMany({
      where: { organizationId, clientId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  emailDispatches(organizationId: string, clientId: string) {
    return this.prisma.documentDispatch.findMany({
      where: {
        organizationId,
        clientId,
        deliveryChannel: 'EMAIL',
      },
      include: {
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

  async outreach(organizationId: string, clientId: string) {
    const [client, campaigns, messages, replies, meetings, mailbox, imports, execution, authorization] = await Promise.all([
      this.prisma.client.findFirst({
        where: { id: clientId, organizationId },
        select: { id: true, setupCompletedAt: true, selectedPlan: true, bookingUrl: true },
      }),
      this.prisma.campaign.findMany({
        where: { organizationId, clientId, archivedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          generationState: true,
          channel: true,
          objective: true,
          offerSummary: true,
          bookingUrlOverride: true,
          startAt: true,
          endAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              leads: true,
              outreachMessages: true,
              replies: true,
              meetings: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 12,
      }),
      this.prisma.outreachMessage.findMany({
        where: { organizationId, clientId },
        select: {
          id: true,
          campaignId: true,
          leadId: true,
          mailboxId: true,
          status: true,
          lifecycle: true,
          messageClass: true,
          subjectLine: true,
          sentAt: true,
          deliveredAt: true,
          openedAt: true,
          clickedAt: true,
          failedAt: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          campaign: { select: { id: true, name: true, status: true } },
          lead: {
            select: {
              id: true,
              status: true,
              contact: { select: { fullName: true, email: true, title: true } },
              account: { select: { companyName: true } },
            },
          },
          mailbox: { select: { id: true, emailAddress: true, status: true, connectionState: true, healthStatus: true } },
        },
        orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
        take: 25,
      }),
      this.prisma.reply.count({ where: { organizationId, clientId } }),
      this.prisma.meeting.count({ where: { organizationId, clientId } }),
      this.safeValue(() => this.getMailboxSummary(organizationId, clientId), this.emptyMailboxSummary()),
      this.safeValue(() => this.getImportSummary(organizationId, clientId), this.emptyImportSummary()),
      this.safeValue(() => this.getExecutionSummary(organizationId, clientId), null),
      this.latestRepresentationAuth(organizationId, clientId),
    ]);

    if (!client) {
      throw new NotFoundException('Client not found in active organization');
    }

    const statusCounts = messages.reduce<Record<string, number>>((counts, message) => {
      const key = String(message.status);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});

    const blockers: Array<{ code: string; label: string; detail: string }> = [];
    if (!client.setupCompletedAt) {
      blockers.push({
        code: 'SETUP_INCOMPLETE',
        label: 'Setup incomplete',
        detail: 'Finish setup before outreach can run.',
      });
    }
    if (!authorization) {
      blockers.push({
        code: 'REPRESENTATION_AUTH_MISSING',
        label: 'Authorization required',
        detail: 'Representation authorization is required before Orchestrate can send outreach on your behalf.',
      });
    }
    if (!mailbox.ready) {
      blockers.push({
        code: 'MAILBOX_NOT_READY',
        label: 'Mailbox not ready',
        detail: mailbox.primary
          ? 'The connected mailbox is not ready for sending.'
          : 'No client-ready mailbox is available yet.',
      });
    }

    const hasRunnableCampaign = campaigns.some((campaign) =>
      ['READY', 'DRAFT', 'PAUSED'].includes(String(campaign.status)),
    );

    return {
      readiness: {
        setupComplete: Boolean(client.setupCompletedAt),
        mailboxReady: mailbox.ready,
        representationAuthorized: Boolean(authorization),
        canStartCampaign: blockers.length === 0 && hasRunnableCampaign,
        canRetryCampaign: blockers.length === 0 && campaigns.some((campaign) => ['ERROR', 'PAUSED'].includes(String(campaign.status))),
        canPauseCampaign: false,
        canReconnectMailbox: false,
        blockers,
      },
      mailbox,
      execution,
      imports,
      summary: {
        campaigns: campaigns.length,
        messages: messages.length,
        queued: statusCounts.QUEUED ?? 0,
        scheduled: statusCounts.SCHEDULED ?? 0,
        sent: statusCounts.SENT ?? 0,
        delivered: statusCounts.DELIVERED ?? 0,
        failed: statusCounts.FAILED ?? 0,
        replies,
        meetings,
      },
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        generationState: campaign.generationState,
        channel: campaign.channel,
        objective: campaign.objective,
        offerSummary: campaign.offerSummary,
        bookingUrl: campaign.bookingUrlOverride ?? client.bookingUrl ?? null,
        startAt: campaign.startAt,
        endAt: campaign.endAt,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        counts: {
          leads: campaign._count.leads,
          messages: campaign._count.outreachMessages,
          replies: campaign._count.replies,
          meetings: campaign._count.meetings,
        },
      })),
      recentMessages: messages.map((message) => ({
        id: message.id,
        campaignId: message.campaignId,
        leadId: message.leadId,
        mailboxId: message.mailboxId,
        status: message.status,
        lifecycle: message.lifecycle,
        messageClass: message.messageClass,
        subjectLine: message.subjectLine,
        sentAt: message.sentAt,
        deliveredAt: message.deliveredAt,
        openedAt: message.openedAt,
        clickedAt: message.clickedAt,
        failedAt: message.failedAt,
        errorMessage: message.errorMessage,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        campaign: message.campaign,
        contact: {
          name: message.lead?.contact?.fullName ?? '',
          email: message.lead?.contact?.email ?? '',
          title: message.lead?.contact?.title ?? '',
          company: message.lead?.account?.companyName ?? '',
          leadStatus: message.lead?.status ?? null,
        },
        mailbox: message.mailbox,
      })),
      actions: {
        startCampaign: blockers.length === 0 && hasRunnableCampaign
          ? { method: 'POST', path: '/client/campaign-profile/start' }
          : null,
        retryCampaign: blockers.length === 0 && campaigns.some((campaign) => ['ERROR', 'PAUSED'].includes(String(campaign.status)))
          ? { method: 'POST', path: '/client/campaign-profile/restart' }
          : null,
        pauseCampaign: null,
        reconnectMailbox: null,
      },
    };
  }

  async replies(organizationId: string, clientId: string) {
    const replies = await this.prisma.reply.findMany({
      where: { organizationId, clientId },
      select: {
        id: true,
        intent: true,
        source: true,
        confidence: true,
        fromEmail: true,
        subjectLine: true,
        bodyText: true,
        receivedAt: true,
        requiresHumanReview: true,
        handledAt: true,
        createdAt: true,
        updatedAt: true,
        campaign: { select: { id: true, name: true, status: true } },
        lead: {
          select: {
            id: true,
            status: true,
            contact: { select: { fullName: true, email: true, title: true } },
            account: { select: { companyName: true, domain: true } },
          },
        },
        message: { select: { id: true, subjectLine: true, bodyText: true, status: true, sentAt: true } },
        meeting: { select: { id: true, status: true, scheduledAt: true, title: true, bookingUrl: true } },
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    return {
      summary: {
        total: replies.length,
        needsReview: replies.filter((reply) => reply.requiresHumanReview).length,
        interested: replies.filter((reply) => String(reply.intent) === 'INTERESTED').length,
        meetings: replies.filter((reply) => Boolean(reply.meeting)).length,
      },
      items: replies.map((reply) => this.replyDto(reply)),
    };
  }

  async meetings(organizationId: string, clientId: string) {
    const [meetings, mailbox] = await Promise.all([
      this.prisma.meeting.findMany({
        where: { organizationId, clientId },
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          completedAt: true,
          title: true,
          bookingUrl: true,
          notesText: true,
          createdAt: true,
          updatedAt: true,
          campaign: { select: { id: true, name: true, status: true } },
          lead: {
            select: {
              id: true,
              status: true,
              contact: { select: { fullName: true, email: true, title: true } },
              account: { select: { companyName: true, domain: true } },
            },
          },
          reply: {
            select: {
              id: true,
              intent: true,
              fromEmail: true,
              subjectLine: true,
              bodyText: true,
              receivedAt: true,
              message: { select: { id: true, subjectLine: true, sentAt: true } },
            },
          },
        },
        orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      this.safeValue(() => this.getMailboxSummary(organizationId, clientId), this.emptyMailboxSummary()),
    ]);

    return {
      provider: {
        calendarConnected: null,
        mailboxReady: mailbox.ready,
        mailbox: mailbox.primary,
      },
      summary: {
        total: meetings.length,
        openHandoffs: meetings.filter((meeting) => String(meeting.status) === 'PROPOSED').length,
        booked: meetings.filter((meeting) => ['BOOKED', 'SCHEDULED'].includes(String(meeting.status))).length,
        completed: meetings.filter((meeting) => String(meeting.status) === 'COMPLETED').length,
        missed: meetings.filter((meeting) => ['MISSED', 'CANCELED'].includes(String(meeting.status))).length,
      },
      items: meetings.map((meeting) => ({
        id: meeting.id,
        status: meeting.status,
        scheduledAt: meeting.scheduledAt,
        completedAt: meeting.completedAt,
        title: meeting.title,
        bookingUrl: meeting.bookingUrl,
        notesText: meeting.notesText,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
        campaign: meeting.campaign,
        contact: {
          name: meeting.lead?.contact?.fullName ?? '',
          email: meeting.lead?.contact?.email ?? meeting.reply?.fromEmail ?? '',
          title: meeting.lead?.contact?.title ?? '',
          company: meeting.lead?.account?.companyName ?? '',
          domain: meeting.lead?.account?.domain ?? '',
          leadStatus: meeting.lead?.status ?? null,
        },
        reply: meeting.reply
          ? {
              id: meeting.reply.id,
              intent: meeting.reply.intent,
              fromEmail: meeting.reply.fromEmail,
              subjectLine: meeting.reply.subjectLine,
              bodyText: meeting.reply.bodyText,
              receivedAt: meeting.reply.receivedAt,
              message: meeting.reply.message,
            }
          : null,
      })),
    };
  }

  async records(organizationId: string, clientId: string) {
    const [agreements, statements, reminders, invoices, receipts, authorizations, imports] = await Promise.all([
      this.agreements(organizationId, clientId),
      this.statements(organizationId, clientId),
      this.reminders(organizationId, clientId),
      this.invoices(organizationId, clientId),
      this.prisma.receipt.findMany({
        where: { organizationId, clientId },
        select: {
          id: true,
          receiptNumber: true,
          amountCents: true,
          currencyCode: true,
          issuedAt: true,
          createdAt: true,
          invoice: { select: { id: true, invoiceNumber: true, status: true } },
        },
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
      this.prisma.clientRepresentationAuth.findMany({
        where: { organizationId, clientId },
        select: {
          id: true,
          version: true,
          acceptedByName: true,
          acceptedByEmail: true,
          acceptedAt: true,
          createdAt: true,
        },
        orderBy: [{ acceptedAt: 'desc' }],
      }),
      this.prisma.importBatch.findMany({
        where: { organizationId, clientId },
        select: {
          id: true,
          campaignId: true,
          sourceLabel: true,
          status: true,
          totalRows: true,
          processedRows: true,
          createdRows: true,
          duplicateRows: true,
          invalidRows: true,
          failedRows: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 25,
      }),
    ]);

    return {
      agreements,
      billingDocuments: {
        invoices,
        receipts,
        statements,
        reminders,
      },
      authorizations,
      sourceRecords: {
        imports,
      },
    };
  }

  private async latestRepresentationAuth(organizationId: string, clientId: string) {
    return this.prisma.clientRepresentationAuth.findFirst({
      where: { organizationId, clientId },
      orderBy: [{ acceptedAt: 'desc' }],
      select: {
        id: true,
        version: true,
        acceptedAt: true,
        acceptedByName: true,
        acceptedByEmail: true,
      },
    });
  }

  private replyDto(reply: any) {
    return {
      id: reply.id,
      intent: reply.intent,
      source: reply.source,
      confidence: this.toNumber(reply.confidence),
      fromEmail: reply.fromEmail,
      subjectLine: reply.subjectLine,
      bodyText: reply.bodyText,
      receivedAt: reply.receivedAt,
      requiresHumanReview: reply.requiresHumanReview,
      handledAt: reply.handledAt,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
      campaign: reply.campaign,
      contact: {
        name: reply.lead?.contact?.fullName ?? '',
        email: reply.lead?.contact?.email ?? reply.fromEmail ?? '',
        title: reply.lead?.contact?.title ?? '',
        company: reply.lead?.account?.companyName ?? '',
        domain: reply.lead?.account?.domain ?? '',
        leadStatus: reply.lead?.status ?? null,
      },
      message: reply.message,
      meeting: reply.meeting,
    };
  }

  private toNumber(value: unknown) {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    const text = String(value);
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async safeValue<T>(loader: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await loader();
    } catch (error) {
      console.warn('[ClientPortalService] client truth query failed', error);
      return fallback;
    }
  }

  private emptyMailboxSummary() {
    return {
      total: 0,
      clientOwned: 0,
      ready: false,
      primary: null,
    };
  }

  private emptyImportSummary() {
    return {
      batches: 0,
      active: 0,
      latest: null,
      totals: {
        rows: 0,
        processed: 0,
        created: 0,
        matched: 0,
        duplicates: 0,
        invalid: 0,
        failed: 0,
      },
    };
  }

  private async getMailboxSummary(organizationId: string, clientId: string) {
    const mailboxes = await this.prisma.mailbox.findMany({
      where: { organizationId, OR: [{ clientId }, { clientId: null }] },
      orderBy: [{ isClientOwned: 'desc' }, { updatedAt: 'desc' }],
    });

    const primary = mailboxes.find((item) => item.clientId === clientId && item.isClientOwned) ?? mailboxes[0] ?? null;

    return {
      total: mailboxes.length,
      clientOwned: mailboxes.filter((item) => item.clientId === clientId && item.isClientOwned).length,
      ready: Boolean(
        primary &&
          primary.status === 'ACTIVE' &&
          primary.healthStatus !== MailboxHealthStatus.CRITICAL &&
          primary.connectionState !== MailboxConnectionState.REQUIRES_REAUTH &&
          primary.connectionState !== MailboxConnectionState.REVOKED,
      ),
      primary: primary
        ? {
            id: primary.id,
            emailAddress: primary.emailAddress,
            label: primary.label,
            status: primary.status,
            healthStatus: primary.healthStatus,
            connectionState: primary.connectionState,
            isClientOwned: primary.isClientOwned,
            connectedAt: primary.connectedAt,
          }
        : null,
    };
  }

  private async getImportSummary(organizationId: string, clientId: string) {
    const [totalsRaw, latestRaw] = await Promise.all([
      this.prisma.importBatch.aggregate({
        where: { organizationId, clientId },
        _sum: {
          totalRows: true,
          processedRows: true,
          createdRows: true,
          duplicateRows: true,
          invalidRows: true,
          failedRows: true,
        },
        _count: { id: true },
      }),
      this.prisma.importBatch.findFirst({
        where: { organizationId, clientId },
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    const totals = totalsRaw as any;
    const latest = latestRaw as any;
    const activeStatuses = [ImportBatchStatus.UPLOADED, ImportBatchStatus.PROCESSING];
    return {
      batches: Number(totals?._count?.id ?? 0),
      active: await this.prisma.importBatch.count({
        where: { organizationId, clientId, status: { in: activeStatuses } },
      }),
      totals: {
        rows: Number(totals?._sum?.totalRows ?? 0),
        processed: Number(totals?._sum?.processedRows ?? 0),
        created: Number(totals?._sum?.createdRows ?? 0),
        matched: 0,
        duplicates: Number(totals?._sum?.duplicateRows ?? 0),
        invalid: Number(totals?._sum?.invalidRows ?? 0),
        failed: Number(totals?._sum?.failedRows ?? 0),
      },
      latest: latest
        ? {
            id: latest.id,
            status: latest.status,
            sourceLabel: latest.sourceLabel ?? null,
            createdAt: latest.createdAt,
            completedAt: latest.updatedAt ?? latest.createdAt,
          }
        : null,
    };
  }

  private async getExecutionSummary(organizationId: string, clientId: string) {
    const activeJobStatuses = [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED];
    const [queuedGeneration, queuedSend, activeImports, waitingMailbox, sent, failed, replies, meetings, mailboxSummary, consentSummary, suppressed] = await Promise.all([
      this.prisma.job.count({ where: { organizationId, clientId, type: JobType.MESSAGE_GENERATION, status: { in: activeJobStatuses } } }),
      this.prisma.job.count({ where: { organizationId, clientId, type: { in: [JobType.FIRST_SEND, JobType.FOLLOWUP_SEND] }, status: { in: activeJobStatuses } } }),
      this.prisma.job.count({ where: { organizationId, clientId, type: JobType.LEAD_IMPORT, status: { in: activeJobStatuses } } }),
      this.prisma.outreachMessage.count({ where: { organizationId, clientId, status: 'QUEUED', OR: [{ sentAt: null }, { mailboxId: null }] } }),
      this.prisma.outreachMessage.count({ where: { organizationId, clientId, status: 'SENT' } }),
      this.prisma.outreachMessage.count({ where: { organizationId, clientId, status: 'FAILED' } }),
      this.prisma.reply.count({ where: { organizationId, clientId } }),
      this.prisma.meeting.count({ where: { organizationId, clientId } }),
      this.getMailboxSummary(organizationId, clientId),
      this.getConsentSummary(organizationId, clientId),
      this.prisma.lead.count({ where: { organizationId, clientId, status: 'SUPPRESSED' } }),
    ]);

    return buildExecutionReadSurface({
      waitingOnImport: activeImports,
      waitingOnMessageGeneration: queuedGeneration,
      queuedForSend: queuedSend,
      waitingOnMailbox: waitingMailbox,
      blockedAtConsent: consentSummary.outreachBlocked,
      blockedAtSuppression: suppressed,
      sent,
      failed,
      replies,
      meetings,
      mailboxReady: mailboxSummary.ready,
    });
  }

  private async getConsentSummary(organizationId: string, clientId: string) {
    const [newsletterUnsubscribed, outreachBlocked] = await Promise.all([
      this.prisma.contactConsent.count({
        where: {
          organizationId,
          clientId,
          communication: CommunicationType.NEWSLETTER,
          status: ContactConsentStatus.UNSUBSCRIBED,
        },
      }),
      this.prisma.contactConsent.count({
        where: {
          organizationId,
          clientId,
          communication: CommunicationType.OUTREACH,
          status: ContactConsentStatus.BLOCKED,
        },
      }),
    ]);

    return {
      newsletterUnsubscribed,
      outreachBlocked,
    };
  }
}
