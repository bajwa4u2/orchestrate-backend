import { Injectable, NotFoundException } from '@nestjs/common';
import { Mailbox, MailboxHealthStatus, MailboxStatus, Prisma, SuppressionType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { CreateSendPolicyDto } from './dto/create-send-policy.dto';
import { CreateSendingDomainDto } from './dto/create-sending-domain.dto';
import { CreateSuppressionEntryDto } from './dto/create-suppression-entry.dto';
import { RegisterBounceDto } from './dto/register-bounce.dto';
import { RegisterComplaintDto } from './dto/register-complaint.dto';

@Injectable()
export class DeliverabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async createDomain(dto: CreateSendingDomainDto) {
    return this.prisma.sendingDomain.create({
      data: {
        organizationId: dto.organizationId,
        clientId: dto.clientId,
        domain: dto.domain.toLowerCase(),
        status: dto.status,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
    });
  }

  async createMailbox(dto: CreateMailboxDto) {
    return this.prisma.mailbox.create({
      data: {
        organizationId: dto.organizationId,
        clientId: dto.clientId,
        domainId: dto.domainId,
        label: dto.label,
        emailAddress: dto.emailAddress.toLowerCase(),
        provider: dto.provider,
        status: dto.status,
        dailySendCap: dto.dailySendCap,
        hourlySendCap: dto.hourlySendCap,
        warmupStatus: dto.warmupStatus,
        healthStatus: dto.healthStatus,
        credentialsJson: toPrismaJson(dto.credentialsJson),
        metadataJson: toPrismaJson(dto.metadataJson),
      },
    });
  }

  async createPolicy(dto: CreateSendPolicyDto) {
    return this.prisma.sendPolicy.create({
      data: {
        organizationId: dto.organizationId,
        clientId: dto.clientId,
        mailboxId: dto.mailboxId,
        scope: dto.scope,
        name: dto.name,
        timezone: dto.timezone,
        dailyCap: dto.dailyCap,
        hourlyCap: dto.hourlyCap,
        minDelaySeconds: dto.minDelaySeconds,
        maxDelaySeconds: dto.maxDelaySeconds,
        allowedWeekdays: dto.allowedWeekdays ?? [1, 2, 3, 4, 5],
        activeFromHour: dto.activeFromHour,
        activeToHour: dto.activeToHour,
        isActive: dto.isActive,
        configJson: toPrismaJson(dto.configJson),
      },
    });
  }

  async createSuppression(dto: CreateSuppressionEntryDto) {
    return this.prisma.suppressionEntry.create({
      data: {
        organizationId: dto.organizationId,
        clientId: dto.clientId,
        contactId: dto.contactId,
        emailAddress: dto.emailAddress?.toLowerCase(),
        domain: dto.domain?.toLowerCase(),
        type: dto.type,
        reason: dto.reason,
        source: dto.source,
      },
    });
  }

  async registerBounce(mailboxId: string, dto: RegisterBounceDto) {
    const mailbox = await this.prisma.mailbox.findUnique({ where: { id: mailboxId } });
    if (!mailbox) throw new NotFoundException(`Mailbox ${mailboxId} not found`);

    const bounce = await this.prisma.bounceEvent.create({
      data: {
        mailboxId,
        messageId: dto.messageId,
        bouncedEmail: dto.bouncedEmail.toLowerCase(),
        bounceType: dto.bounceType,
        reason: dto.reason,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
    });

    await this.createSuppression({
      organizationId: mailbox.organizationId,
      clientId: mailbox.clientId || undefined,
      emailAddress: dto.bouncedEmail.toLowerCase(),
      type: SuppressionType.HARD_BOUNCE,
      reason: dto.reason || dto.bounceType || 'Bounce registered',
      source: 'bounce_event',
    });

    const health = await this.refreshMailboxHealth(mailboxId);
    return { ok: true, bounce, health };
  }

  async registerComplaint(mailboxId: string, dto: RegisterComplaintDto) {
    const mailbox = await this.prisma.mailbox.findUnique({ where: { id: mailboxId } });
    if (!mailbox) throw new NotFoundException(`Mailbox ${mailboxId} not found`);

    const complaint = await this.prisma.complaintEvent.create({
      data: {
        mailboxId,
        messageId: dto.messageId,
        complainedEmail: dto.complainedEmail.toLowerCase(),
        reason: dto.reason,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
    });

    await this.createSuppression({
      organizationId: mailbox.organizationId,
      clientId: mailbox.clientId || undefined,
      emailAddress: dto.complainedEmail.toLowerCase(),
      type: SuppressionType.COMPLAINT,
      reason: dto.reason || 'Complaint registered',
      source: 'complaint_event',
    });

    const health = await this.refreshMailboxHealth(mailboxId);
    return { ok: true, complaint, health };
  }

  async refreshMailboxHealth(mailboxId: string) {
    const mailbox = await this.prisma.mailbox.findUnique({ where: { id: mailboxId } });
    if (!mailbox) throw new NotFoundException(`Mailbox ${mailboxId} not found`);

    const start = startOfDay();
    const [sentCount, replyCount, bounceCount, complaintCount] = await Promise.all([
      this.prisma.outreachMessage.count({ where: { mailboxId, sentAt: { gte: start } } }),
      this.prisma.reply.count({ where: { mailboxId, receivedAt: { gte: start } } }),
      this.prisma.bounceEvent.count({ where: { mailboxId, occurredAt: { gte: start } } }),
      this.prisma.complaintEvent.count({ where: { mailboxId, occurredAt: { gte: start } } }),
    ]);

    const score = Math.max(0, 100 - bounceCount * 25 - complaintCount * 40 + replyCount * 3 - Math.max(0, sentCount - mailbox.dailySendCap) * 2);
    const healthStatus =
      complaintCount > 0 ? MailboxHealthStatus.CRITICAL :
      bounceCount >= 2 ? MailboxHealthStatus.DEGRADED :
      score < 75 ? MailboxHealthStatus.WATCH :
      MailboxHealthStatus.HEALTHY;

    await this.prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        healthStatus,
        healthScore: new Prisma.Decimal(score.toFixed(2)),
        status: healthStatus === MailboxHealthStatus.CRITICAL ? MailboxStatus.PAUSED : mailbox.status,
        lastSyncedAt: new Date(),
      },
    });

    const event = await this.prisma.mailboxHealthEvent.create({
      data: {
        mailboxId,
        status: healthStatus,
        sentCount,
        replyCount,
        bounceCount,
        complaintCount,
        score: new Prisma.Decimal(score.toFixed(2)),
        metadataJson: { period: 'day' } as Prisma.InputJsonValue,
      },
    });

    return {
      ok: true,
      mailboxId,
      status: healthStatus,
      score,
      sentCount,
      replyCount,
      bounceCount,
      complaintCount,
      eventId: event.id,
    };
  }

  async findSuppressionForRecipient(input: { organizationId: string; clientId?: string; emailAddress: string }) {
    const emailAddress = input.emailAddress.toLowerCase();
    const domain = emailAddress.split('@')[1];
    return this.prisma.suppressionEntry.findFirst({
      where: {
        organizationId: input.organizationId,
        AND: [
          {
            OR: [
              { emailAddress },
              ...(domain ? [{ domain }] : []),
            ],
          },
          ...(input.clientId ? [{ OR: [{ clientId: input.clientId }, { clientId: null }] }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async pickMailboxForClient(input: { organizationId: string; clientId?: string }): Promise<Mailbox | null> {
    return this.prisma.mailbox.findFirst({
      where: {
        organizationId: input.organizationId,
        status: MailboxStatus.ACTIVE,
        ...(input.clientId ? { OR: [{ clientId: input.clientId }, { clientId: null }] } : {}),
      },
      orderBy: [
        { healthStatus: 'asc' },
        { updatedAt: 'desc' },
      ],
    });
  }

  async assertCanSendNow(input: { organizationId: string; clientId?: string; campaignId?: string; mailbox: Mailbox }) {
    const policy = await this.prisma.sendPolicy.findFirst({
      where: {
        organizationId: input.organizationId,
        isActive: true,
        OR: [
          { mailboxId: input.mailbox.id },
          ...(input.clientId ? [{ clientId: input.clientId }] : []),
          { clientId: null, mailboxId: null },
        ],
      },
      orderBy: [
        { mailboxId: 'desc' },
        { clientId: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const now = new Date();
    const sentToday = await this.prisma.outreachMessage.count({
      where: {
        mailboxId: input.mailbox.id,
        sentAt: { gte: startOfDay() },
      },
    });

    const sentHour = await this.prisma.outreachMessage.count({
      where: {
        mailboxId: input.mailbox.id,
        sentAt: { gte: startOfHour() },
      },
    });

    const weekday = now.getDay() === 0 ? 7 : now.getDay();
    const hour = now.getHours();
    const dailyCap = policy?.dailyCap ?? input.mailbox.dailySendCap;
    const hourlyCap = policy?.hourlyCap ?? input.mailbox.hourlySendCap;

    if (dailyCap && sentToday >= dailyCap) {
      return { allowed: false, reason: `Daily cap reached for mailbox ${input.mailbox.emailAddress}` };
    }
    if (hourlyCap && sentHour >= hourlyCap) {
      return { allowed: false, reason: `Hourly cap reached for mailbox ${input.mailbox.emailAddress}` };
    }
    if (policy?.allowedWeekdays?.length && !policy.allowedWeekdays.includes(weekday)) {
      return { allowed: false, reason: `Weekday ${weekday} is blocked by send policy` };
    }
    if (policy?.activeFromHour != null && hour < policy.activeFromHour) {
      return { allowed: false, reason: 'Current time is before allowed send window' };
    }
    if (policy?.activeToHour != null && hour > policy.activeToHour) {
      return { allowed: false, reason: 'Current time is after allowed send window' };
    }
    if (
      input.mailbox.healthStatus === MailboxHealthStatus.DEGRADED ||
      input.mailbox.healthStatus === MailboxHealthStatus.CRITICAL
    ) {
      return { allowed: false, reason: `Mailbox ${input.mailbox.emailAddress} health is ${input.mailbox.healthStatus}` };
    }

    return { allowed: true, policyId: policy?.id };
  }

  async overview(filters: { organizationId?: string; clientId?: string }) {
    const where = {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
    };

    const [domains, mailboxes, policies, suppressions, bounces, complaints] = await Promise.all([
      this.prisma.sendingDomain.findMany({ where, orderBy: { createdAt: 'desc' } }),
      this.prisma.mailbox.findMany({ where, orderBy: { createdAt: 'desc' } }),
      this.prisma.sendPolicy.findMany({ where, orderBy: { createdAt: 'desc' } }),
      this.prisma.suppressionEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.bounceEvent.findMany({ where: filters.clientId ? { mailbox: { clientId: filters.clientId } } : undefined, orderBy: { occurredAt: 'desc' }, take: 25 }),
      this.prisma.complaintEvent.findMany({ where: filters.clientId ? { mailbox: { clientId: filters.clientId } } : undefined, orderBy: { occurredAt: 'desc' }, take: 25 }),
    ]);

    return {
      domains,
      mailboxes,
      policies,
      suppressions,
      bounces,
      complaints,
    };
  }
}

function startOfDay() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function startOfHour() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now;
}
