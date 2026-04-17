import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BillingService } from '../billing/billing.service';

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
    if (!client) throw new NotFoundException('Client not found in active organization');

    const [billing, replies, meetings, notifications, emailDispatches, totalLeads, sendableLeadCount] = await Promise.all([
      this.billingService.overview(organizationId, clientId),
      this.prisma.reply.count({ where: { organizationId, clientId } }),
      this.prisma.meeting.count({ where: { organizationId, clientId } }),
      this.prisma.alert.count({ where: { organizationId, clientId, status: 'OPEN' } }),
      this.prisma.documentDispatch.count({ where: { organizationId, clientId, deliveryChannel: 'EMAIL' } }),
      this.prisma.lead.count({ where: { organizationId, clientId } }),
      this.prisma.lead.count({
        where: {
          organizationId,
          clientId,
          status: { not: 'SUPPRESSED' },
          contact: {
            is: {
              email: { not: null },
            },
          },
        },
      }),
    ]);

    return {
      client,
      billing,
      activity: {
        leadCount: totalLeads,
        sendableLeadCount,
        replies,
        meetings,
      },
      communications: {
        openNotifications: notifications,
        emailDispatches,
        portalUrl: `${process.env.CLIENT_PORTAL_BASE_URL ?? 'https://orchestrateops.com/client'}?clientId=${clientId}`,
      },
    };
  }

  async leads(organizationId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found in active organization');
    }

    const leads = await this.prisma.lead.findMany({
      where: { organizationId, clientId },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        account: {
          select: {
            id: true,
            name: true,
            websiteUrl: true,
          },
        },
        contact: {
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
        },
        leadSource: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });

    return leads.map((lead) => {
      const contact = lead.contact;
      const account = lead.account;
      const campaign = lead.campaign;
      const leadSource = lead.leadSource;

      const location = [contact?.city, contact?.region, contact?.countryCode]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(', ');

      return {
        id: lead.id,
        name: contact?.fullName ?? '',
        company: account?.name ?? '',
        title: contact?.title ?? '',
        email: contact?.email ?? '',
        phone: contact?.phone ?? '',
        location,
        campaign: campaign?.name ?? '',
        status: lead.status,
        source: leadSource?.name ?? lead.source,
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
      include: { invoiceLinks: { include: { invoice: true } }, paymentLinks: { include: { payment: true } } },
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
      where: { organizationId, clientId, deliveryChannel: 'EMAIL' },
      include: { template: true, invoice: true, statement: true, agreement: true, receipt: true, reminder: true },
      orderBy: [{ createdAt: 'desc' }],
    });
  }
}
