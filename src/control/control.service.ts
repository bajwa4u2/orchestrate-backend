import { Injectable } from '@nestjs/common';
import { AlertStatus, JobStatus, MailboxHealthStatus, MailboxStatus, MeetingStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ControlService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId?: string) {
    const scopedWhere = organizationId ? { organizationId } : undefined;
    const organizationWhere = organizationId ? { id: organizationId } : undefined;

    const [
      organizations,
      clients,
      campaigns,
      leads,
      messages,
      replies,
      meetings,
      jobsQueued,
      jobsFailed,
      alertsOpen,
      activeMailboxes,
      degradedMailboxes,
      sentToday,
      repliedToday,
      bookedToday,
    ] = await Promise.all([
      this.prisma.organization.count({ where: organizationWhere }),
      this.prisma.client.count({ where: scopedWhere }),
      this.prisma.campaign.count({ where: scopedWhere }),
      this.prisma.lead.count({ where: scopedWhere }),
      this.prisma.outreachMessage.count({ where: scopedWhere }),
      this.prisma.reply.count({ where: scopedWhere }),
      this.prisma.meeting.count({ where: scopedWhere }),
      this.prisma.job.count({ where: { ...(scopedWhere ?? {}), status: JobStatus.QUEUED } }),
      this.prisma.job.count({ where: { ...(scopedWhere ?? {}), status: JobStatus.FAILED } }),
      this.prisma.alert.count({ where: { ...(scopedWhere ?? {}), status: AlertStatus.OPEN } }),
      this.prisma.mailbox.count({ where: { ...(scopedWhere ?? {}), status: MailboxStatus.ACTIVE } }),
      this.prisma.mailbox.count({
        where: {
          ...(scopedWhere ?? {}),
          healthStatus: { in: [MailboxHealthStatus.DEGRADED, MailboxHealthStatus.CRITICAL] },
        },
      }),
      this.prisma.outreachMessage.count({
        where: {
          ...(scopedWhere ?? {}),
          sentAt: { gte: startOfDay() },
        },
      }),
      this.prisma.reply.count({
        where: {
          ...(scopedWhere ?? {}),
          receivedAt: { gte: startOfDay() },
        },
      }),
      this.prisma.meeting.count({
        where: {
          ...(scopedWhere ?? {}),
          status: MeetingStatus.BOOKED,
          updatedAt: { gte: startOfDay() },
        },
      }),
    ]);

    return {
      system: {
        phase: 'execution-core',
        posture: 'one system, one core loop, one control point',
      },
      totals: {
        organizations,
        clients,
        campaigns,
        leads,
        messages,
        replies,
        meetings,
      },
      today: {
        sent: sentToday,
        replies: repliedToday,
        booked: bookedToday,
      },
      execution: {
        queuedJobs: jobsQueued,
        failedJobs: jobsFailed,
      },
      deliverability: {
        activeMailboxes,
        degradedMailboxes,
      },
      alerts: {
        open: alertsOpen,
      },
    };
  }
}

function startOfDay() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}
