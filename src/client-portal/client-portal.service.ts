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
      this.billingService.overview(organizationId, clientId),
      this.prisma.reply.count({ where: { organizationId, clientId } }),
      this.prisma.meeting.count({ where: { organizationId, clientId } }),
      this.prisma.alert.count({
        where: { organizationId, clientId, status: 'OPEN' },
      }),
      this.prisma.documentDispatch.count({
        where: {
          organizationId,
          clientId,
          deliveryChannel: 'EMAIL',
        },
      }),
      this.prisma.lead.count({ where: { organizationId, clientId } }),
      this.prisma.contact.count({ where: { organizationId, clientId } }),
      this.prisma.contactChannel.count({ where: { organizationId, clientId } }),
      this.prisma.lead.count({
        where: {
          organizationId,
          clientId,
          status: { not: 'SUPPRESSED' },
          OR: [
            { contact: { is: { contactChannels: { some: { type: 'EMAIL', status: 'ACTIVE' } } } } },
            { contact: { is: { email: { not: null } } } },
          ],
        },
      }),
      this.getMailboxSummary(organizationId, clientId),
      this.getImportSummary(organizationId, clientId),
      this.getExecutionSummary(organizationId, clientId),
      this.getConsentSummary(organizationId, clientId),
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
      where: {
        organizationId,
        clientId,
      },
      include: {
        contact: { include: { contactChannels: { where: { type: 'EMAIL' }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 } } },
        account: true,
        campaign: true,
        leadSource: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return leads.map((lead) => {
      const contact = lead.contact;
      const account = lead.account;
      const campaign = lead.campaign;
      const leadSource = lead.leadSource;
      const primaryChannel = Array.isArray((contact as any)?.contactChannels) ? (contact as any).contactChannels[0] : null;

      const location = [contact?.city, contact?.region, contact?.countryCode]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(', ');

      return {
        id: lead.id,
        name: contact?.fullName ?? '',
        company: account?.companyName ?? '',
        title: contact?.title ?? '',
        email: primaryChannel?.value ?? contact?.email ?? '',
        phone: contact?.phone ?? '',
        location,
        campaign: campaign?.name ?? '',
        status: lead.status,
        qualificationState: lead.qualificationState,
        source: leadSource?.name ?? String(lead.source),
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
