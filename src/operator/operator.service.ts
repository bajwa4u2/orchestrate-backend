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
}
