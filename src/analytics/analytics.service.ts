import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async sourceYield(campaignId: string, organizationId: string) {
    const runs = await this.prisma.sourceRun.findMany({
      where: { campaignId, organizationId },
      orderBy: { startedAt: 'desc' },
    });
    const reachability = await this.prisma.reachabilityRecord.findMany({ where: { campaignId, organizationId } });
    const qualifications = await this.prisma.qualificationDecision.findMany({ where: { campaignId, organizationId } });

    return {
      runs,
      reachabilityCount: reachability.length,
      acceptedCount: qualifications.filter((item) => item.decision === 'ACCEPT').length,
      holdCount: qualifications.filter((item) => item.decision === 'HOLD').length,
      discardCount: qualifications.filter((item) => item.decision === 'DISCARD').length,
    };
  }

  async conversion(campaignId: string, organizationId: string) {
    const [responses, meetings, providerUsage] = await Promise.all([
      this.prisma.reply.count({ where: { campaignId, organizationId } }),
      this.prisma.meeting.count({ where: { campaignId, organizationId } }),
      this.prisma.providerUsageLog.findMany({ where: { campaignId, organizationId }, orderBy: { createdAt: 'desc' } }),
    ]);

    return {
      responses,
      meetings,
      providerUsage,
    };
  }
}
