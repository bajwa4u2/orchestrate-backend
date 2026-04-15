import { Injectable } from '@nestjs/common';
import { JobStatus, MailboxHealthStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    const now = new Date().toISOString();
    const [
      db,
      queuedJobs,
      failedJobs,
      degradedMailboxes,
    ] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok'),
      this.prisma.job.count({ where: { status: JobStatus.QUEUED } }),
      this.prisma.job.count({ where: { status: JobStatus.FAILED } }),
      this.prisma.mailbox.count({ where: { healthStatus: { in: [MailboxHealthStatus.DEGRADED, MailboxHealthStatus.CRITICAL] } } }),
    ]);

    return {
      ok: true,
      service: 'orchestrate-backend',
      phase: 'launch-readiness',
      timestamp: now,
      database: db?.[0]?.ok === 1 ? 'connected' : 'unknown',
      domain: process.env.APP_BASE_URL ?? 'https://orchestrateops.com',
      emailDeliveryMode: process.env.EMAIL_DELIVERY_MODE ?? 'log',
      mailFromAddress: process.env.MAIL_FROM_ADDRESS ?? 'hello@orchestrateops.com',
      execution: {
        automaticDispatchEnabled: (process.env.EXECUTION_DISPATCH_ENABLED?.trim() || '').toLowerCase() === 'true',
        queuedJobs,
        failedJobs,
      },
      deliverability: {
        degradedMailboxes,
      },
      environment: {
        authSecretConfigured: Boolean(process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim()),
        inboundReplySecretConfigured: Boolean(process.env.INBOUND_REPLY_SECRET?.trim()),
        resendWebhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
        stripeWebhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
      },
    };
  }
}
