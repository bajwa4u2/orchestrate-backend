import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { ControlService } from '../control/control.service';

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
    const take = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 8;

    const [items, receivedCount, notifiedCount, acknowledgedCount, closedCount, spamCount] = await Promise.all([
      this.prisma.publicInquiry.findMany({
        orderBy: { submittedAt: 'desc' },
        take,
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          inquiryType: true,
          status: true,
          message: true,
          submittedAt: true,
          notifiedAt: true,
          acknowledgedAt: true,
        },
      }),
      this.prisma.publicInquiry.count({ where: { status: 'RECEIVED' } }),
      this.prisma.publicInquiry.count({ where: { status: 'NOTIFIED' } }),
      this.prisma.publicInquiry.count({ where: { status: 'ACKNOWLEDGED' } }),
      this.prisma.publicInquiry.count({ where: { status: 'CLOSED' } }),
      this.prisma.publicInquiry.count({ where: { status: 'SPAM' } }),
    ]);

    return {
      items,
      summary: {
        totalOpen: receivedCount + notifiedCount + acknowledgedCount,
        received: receivedCount,
        notified: notifiedCount,
        acknowledged: acknowledgedCount,
        closed: closedCount,
        spam: spamCount,
      },
    };
  }
}
