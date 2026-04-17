import { Injectable, NotFoundException } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../database/prisma.service';

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
      sendableLeads,
    ] = await Promise.all([
      this.billingService.overview(organizationId, clientId),
      this.prisma.reply.count({
        where: { organizationId, clientId },
      }),
      this.prisma.meeting.count({
        where: { organizationId, clientId },
      }),
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
      this.prisma.lead.count({
        where: {
          organizationId,
          clientId,
        },
      }),
      this.prisma.lead.count({
        where: {
          organizationId,
          clientId,
          status: {
            not: 'SUPPRESSED',
          },
          contact: {
            is: {
              email: {
                not: null,
              },
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
        sendableLeadCount: sendableLeads,
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
}