import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InquiryChannel,
  InquiryDirection,
  InquiryMessageType,
  Prisma,
  PublicInquiryStatus,
  AlertStatus,
  ContactEmailStatus,
  JobStatus,
  MailboxConnectionState,
  MailboxHealthStatus,
  MailboxStatus,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { ControlService } from '../control/control.service';
import { PrismaService } from '../database/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EmailsService } from '../emails/emails.service';
import { DeliverabilityService } from '../deliverability/deliverability.service';
import { buildExecutionReadSurface } from '../common/utils/execution-read-surface';
import { structuredLog } from '../common/observability/structured-logger';
import { AssignInquiryDto } from './dto/assign-inquiry.dto';
import { CreateInquiryNoteDto } from './dto/create-inquiry-note.dto';
import { CreateInquiryReplyDto } from './dto/create-inquiry-reply.dto';
import {
  PublicInquiryStatusDto,
  UpdateInquiryStatusDto,
} from './dto/update-inquiry-status.dto';

@Injectable()
export class OperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly controlService: ControlService,
    private readonly billingService: BillingService,
    private readonly clientsService: ClientsService,
    private readonly campaignsService: CampaignsService,
    private readonly emailsService: EmailsService,
    private readonly deliverabilityService: DeliverabilityService,
  ) {}

  async commandOverview(organizationId: string) {
    const scopeOrganizationId = await this.resolveOperatorScope(organizationId);
    const [overview, deliverability, imports, consent, activeJobs, messageStatuses, replies, meetings, suppressed, suppressionTypes, invalidContacts, bouncedContacts] = await Promise.all([
      this.safeValue(() => this.controlService.overview(scopeOrganizationId), this.emptyControlOverview()),
      this.safeValue(() => this.deliverabilityService.overview(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}), this.emptyDeliverabilityOverview()),
      this.safeValue(() => this.prisma.importBatch.aggregate({
        where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined,
        _count: { _all: true },
        _sum: { totalRows: true, processedRows: true, createdRows: true, duplicateRows: true, invalidRows: true, failedRows: true },
      }), { _count: { _all: 0 }, _sum: { totalRows: 0, processedRows: 0, createdRows: 0, duplicateRows: 0, invalidRows: 0, failedRows: 0 } }),
      this.safeValue(() => this.prisma.contactConsent.groupBy({
        by: ['communication', 'status'],
        where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined,
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.job.groupBy({
        by: ['type'],
        where: {
          ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}),
          status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED] },
        },
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.outreachMessage.groupBy({
        by: ['status'],
        where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined,
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.reply.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }), 0),
      this.safeValue(() => this.prisma.meeting.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }), 0),
      this.safeValue(() => this.prisma.lead.count({ where: { ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}), status: 'SUPPRESSED' } }), 0),
      this.safeValue(() => this.prisma.suppressionEntry.groupBy({
        by: ['type'],
        where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined,
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.contact.count({
        where: { ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}), emailStatus: ContactEmailStatus.INVALID },
      }), 0),
      this.safeValue(() => this.prisma.contact.count({
        where: { ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}), emailStatus: ContactEmailStatus.BOUNCED },
      }), 0),
    ]);

    const mailboxes = Array.isArray((deliverability as any)?.mailboxes) ? (deliverability as any).mailboxes : [];
    const mailboxSummary = this.buildMailboxDebugSummary(mailboxes);
    const needsAttention = mailboxSummary.needsAttention;
    const findJobCount = (type: string) => activeJobs.find((item: any) => item.type === type)?._count?._all ?? 0;
    const findMessageCount = (status: string) => messageStatuses.find((item: any) => item.status === status)?._count?._all ?? 0;
    const outreachBlocked = consent.find((item: any) => item.communication === 'OUTREACH' && item.status === 'BLOCKED')?._count?._all ?? 0;
    const importDuplicates = imports._sum.duplicateRows ?? 0;
    const importInvalid = imports._sum.invalidRows ?? 0;
    const suppressionAudit = this.buildSuppressionDebugSummary({
      suppressedLeads: suppressed,
      suppressionTypes,
      outreachBlocked,
      invalidContacts,
      bouncedContacts,
      importDuplicates,
      importInvalid,
    });
    const executionCounts = {
      waitingOnImport: findJobCount('LEAD_IMPORT'),
      waitingOnMessageGeneration: findJobCount('MESSAGE_GENERATION'),
      queuedForSend: findJobCount('FIRST_SEND') + findJobCount('FOLLOWUP_SEND'),
      waitingOnMailbox: needsAttention,
      blockedAtConsent: outreachBlocked,
      blockedAtSuppression: suppressed,
      sent: findMessageCount('SENT'),
      failed: findMessageCount('FAILED'),
      replies,
      meetings,
    };
    const execution = buildExecutionReadSurface({
      ...executionCounts,
      mailboxReady: mailboxSummary.sendCapable > 0 && needsAttention === 0,
    });

    return {
      ...overview,
      imports: {
        batches: imports._count._all,
        rows: imports._sum.totalRows ?? 0,
        processed: imports._sum.processedRows ?? 0,
        created: imports._sum.createdRows ?? 0,
        duplicates: imports._sum.duplicateRows ?? 0,
        invalid: imports._sum.invalidRows ?? 0,
        failed: imports._sum.failedRows ?? 0,
      },
      permissions: consent.map((item) => ({ communication: item.communication, status: item.status, total: item._count._all })),
      permissionSummary: this.buildPermissionDebugSummary(consent),
      mailboxes: mailboxSummary,
      suppressionAudit,
      execution: {
        ...execution,
        aggregate: this.buildExecutionDebugAggregate(execution.stage, executionCounts),
      },
    };
  }

  private buildMailboxDebugSummary(mailboxes: any[]) {
    const countBy = (predicate: (item: any) => boolean) => mailboxes.filter(predicate).length;
    const authorized = countBy((item) => item.connectionState === MailboxConnectionState.AUTHORIZED);
    const bootstrapped = countBy((item) => item.connectionState === MailboxConnectionState.BOOTSTRAPPED);
    const pendingAuth = countBy((item) => item.connectionState === MailboxConnectionState.PENDING_AUTH);
    const requiresReauth = countBy((item) => item.connectionState === MailboxConnectionState.REQUIRES_REAUTH);
    const revoked = countBy((item) => item.connectionState === MailboxConnectionState.REVOKED);
    const active = countBy((item) => item.status === MailboxStatus.ACTIVE);
    const critical = countBy((item) => item.healthStatus === MailboxHealthStatus.CRITICAL);
    const degraded = countBy((item) => item.healthStatus === MailboxHealthStatus.DEGRADED);
    const sendCapable = countBy((item) =>
      item.status === MailboxStatus.ACTIVE &&
      [MailboxConnectionState.AUTHORIZED, MailboxConnectionState.BOOTSTRAPPED].includes(item.connectionState) &&
      ![MailboxHealthStatus.DEGRADED, MailboxHealthStatus.CRITICAL].includes(item.healthStatus),
    );
    const needsAttention = pendingAuth + requiresReauth + revoked + critical;

    return {
      total: mailboxes.length,
      connected: authorized + bootstrapped,
      authorized,
      bootstrapped,
      pendingAuth,
      requiresReauth,
      revoked,
      active,
      degraded,
      critical,
      sendCapable,
      needsAttention,
      status:
        mailboxes.length === 0
          ? 'NO_MAILBOX'
          : sendCapable > 0
            ? 'SEND_CAPABLE'
            : pendingAuth > 0
              ? 'AUTH_PENDING'
              : requiresReauth > 0 || revoked > 0
                ? 'RECONNECT_REQUIRED'
                : critical > 0
                  ? 'CRITICAL_HEALTH'
                  : 'NOT_SEND_CAPABLE',
    };
  }

  private buildSuppressionDebugSummary(input: {
    suppressedLeads: number;
    suppressionTypes: Array<{ type: string; _count: { _all: number } }>;
    outreachBlocked: number;
    invalidContacts: number;
    bouncedContacts: number;
    importDuplicates: number;
    importInvalid: number;
  }) {
    const typeCount = (type: string) => input.suppressionTypes.find((item) => item.type === type)?._count?._all ?? 0;
    const causes = {
      unsubscribed: typeCount('UNSUBSCRIBE'),
      bounced: typeCount('HARD_BOUNCE') + input.bouncedContacts,
      duplicate: input.importDuplicates,
      invalid: input.importInvalid + input.invalidContacts,
      consent: input.outreachBlocked,
      policy: typeCount('COMPLAINT') + typeCount('MANUAL_BLOCK'),
    };

    return {
      totalSuppressedLeads: input.suppressedLeads,
      causes,
      sourceCounts: {
        suppressionEntries: input.suppressionTypes.reduce((total, item) => total + (item._count?._all ?? 0), 0),
        consentBlocks: input.outreachBlocked,
        invalidContacts: input.invalidContacts,
        bouncedContacts: input.bouncedContacts,
        duplicateImportRows: input.importDuplicates,
        invalidImportRows: input.importInvalid,
      },
    };
  }

  private buildPermissionDebugSummary(consent: Array<{ communication: string; status: string; _count: { _all: number } }>) {
    const total = consent.reduce((sum, item) => sum + (item._count?._all ?? 0), 0);
    const blocked = consent
      .filter((item) => item.status === 'BLOCKED' || item.status === 'UNSUBSCRIBED')
      .reduce((sum, item) => sum + (item._count?._all ?? 0), 0);
    const allowed = consent
      .filter((item) => item.status === 'ALLOWED' || item.status === 'SUBSCRIBED')
      .reduce((sum, item) => sum + (item._count?._all ?? 0), 0);
    return {
      total,
      allowed,
      blocked,
      status: total === 0 ? 'NO_CONSENT_RECORDS' : blocked > 0 ? 'HAS_BLOCKS' : 'CLEAR',
    };
  }

  private buildExecutionDebugAggregate(stage: string, counts: Record<string, number>) {
    const signals = Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({ key, value }));
    return {
      mixed: signals.length > 1,
      displayStage: signals.length > 1 ? 'MIXED_ACTIVITY' : stage,
      signals,
      summary:
        signals.length > 1
          ? 'Multiple lifecycle signals are active; read the counts together instead of treating the stage as the only state.'
          : 'A single dominant lifecycle signal is active.',
    };
  }

  async commandWorkspace(organizationId: string) {
    const scopeOrganizationId = await this.resolveOperatorScope(organizationId);

    const [
      overview,
      deliverability,
      campaigns,
      clients,
      publicInquiries,
      alerts,
      failedJobs,
      outreachMessages,
      replies,
    ] = await Promise.all([
      this.safeValue(() => this.controlService.overview(scopeOrganizationId), this.emptyControlOverview()),
      this.safeValue(() => this.deliverabilityService.overview(
        scopeOrganizationId ? { organizationId: scopeOrganizationId } : {},
      ), this.emptyDeliverabilityOverview()),
      this.safeValue(() => this.campaignsService.list(
        (scopeOrganizationId
          ? { organizationId: scopeOrganizationId, page: '1', limit: '10' }
          : { page: '1', limit: '10' }) as any,
      ), { items: [], meta: { page: 1, limit: 10, total: 0 } }),
      this.safeValue(() => this.clientsService.list(
        (scopeOrganizationId
          ? { organizationId: scopeOrganizationId, page: '1', limit: '10' }
          : { page: '1', limit: '10' }) as any,
      ), { items: [], meta: { page: 1, limit: 10, total: 0 } }),
      this.safeValue(() => this.listPublicInquiries(scopeOrganizationId, { limit: '10' }), { items: [], summary: this.emptyInquirySummary() }),
      this.safeValue(() => this.prisma.alert.findMany({
        where: {
          ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}),
          status: AlertStatus.OPEN,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 10,
      }), []),
      this.safeValue(() => this.prisma.job.findMany({
        where: {
          ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}),
          status: JobStatus.FAILED,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 10,
        include: {
          client: { select: { id: true, displayName: true, legalName: true } },
          campaign: { select: { id: true, name: true, status: true } },
        },
      }), []),
      this.prisma.outreachMessage.findMany({
        where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : {},
        orderBy: [{ updatedAt: 'desc' }],
        take: 12,
        include: {
          client: { select: { id: true, displayName: true, legalName: true } },
          campaign: { select: { id: true, name: true, status: true } },
          mailbox: { select: { id: true, emailAddress: true, label: true } },
          lead: {
            select: {
              id: true,
              contact: { select: { fullName: true, email: true } },
            },
          },
        },
      }),
      this.prisma.reply.findMany({
        where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : {},
        orderBy: [{ receivedAt: 'desc' }],
        take: 10,
        include: {
          client: { select: { id: true, displayName: true, legalName: true } },
          campaign: { select: { id: true, name: true, status: true } },
          mailbox: { select: { id: true, emailAddress: true, label: true } },
          meeting: { select: { id: true, status: true, scheduledAt: true } },
          lead: {
            select: {
              id: true,
              contact: { select: { fullName: true, email: true } },
            },
          },
        },
      }),
    ]);

    const campaignItems = Array.isArray(campaigns?.items) ? campaigns.items : [];
    const clientItems = Array.isArray(clients?.items) ? clients.items : [];
    const publicInquiryItems = Array.isArray(publicInquiries?.items) ? publicInquiries.items : [];
    const alertItems = Array.isArray(alerts) ? alerts : [];
    const failedJobItems = Array.isArray(failedJobs) ? failedJobs : [];
    const mailboxItems = Array.isArray(deliverability?.mailboxes) ? deliverability.mailboxes : [];

    const healthyMailboxes = mailboxItems.filter((item) => this.isHealthyMailbox(item)).length;
    const degradedMailboxes = mailboxItems.filter((item) => this.isDegradedMailbox(item)).length;

    const emailDispatches = outreachMessages.map((message) => ({
      id: message.id,
      subject: message.subjectLine ?? '',
      templateName: message.campaign?.name ?? 'Outreach',
      recipientEmail: message.lead?.contact?.email ?? '',
      recipientName: message.lead?.contact?.fullName ?? '',
      status: message.status,
      createdAt: message.createdAt,
      sentAt: message.sentAt,
      failedAt: message.failedAt,
      error: message.errorMessage ?? '',
      clientName: message.client?.displayName ?? message.client?.legalName ?? '',
      campaignName: message.campaign?.name ?? '',
      mailboxEmail: message.mailbox?.emailAddress ?? '',
    }));

    const replyItems = replies.map((reply) => ({
      id: reply.id,
      kind: 'reply',
      subject: reply.subjectLine ?? 'Reply received',
      name: reply.lead?.contact?.fullName ?? reply.fromEmail ?? 'Reply',
      email: reply.fromEmail ?? reply.lead?.contact?.email ?? '',
      status: reply.handledAt
        ? 'HANDLED'
        : reply.requiresHumanReview
          ? 'REVIEW'
          : 'RECEIVED',
      createdAt: reply.receivedAt,
      message: reply.bodyText ?? '',
      clientName: reply.client?.displayName ?? reply.client?.legalName ?? '',
      campaignName: reply.campaign?.name ?? '',
      meetingStatus: reply.meeting?.status ?? null,
      meetingScheduledAt: reply.meeting?.scheduledAt ?? null,
    }));

    const conversationItems = [...replyItems, ...publicInquiryItems]
      .sort((a: any, b: any) => {
        const aTime = new Date(a.createdAt ?? 0).getTime();
        const bTime = new Date(b.createdAt ?? 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 10);

    const executionSurface = buildExecutionReadSurface({
      waitingOnImport: failedJobItems.filter((job) => job.type === 'LEAD_IMPORT').length,
      waitingOnMessageGeneration: emailDispatches.filter((message) => message.status === 'QUEUED').length,
      queuedForSend: emailDispatches.filter((message) => message.status === 'QUEUED' || message.status === 'SCHEDULED').length,
      waitingOnMailbox: degradedMailboxes,
      sent: emailDispatches.filter((message) => message.status === 'SENT').length,
      failed: failedJobItems.length + emailDispatches.filter((message) => message.status === 'FAILED').length,
      replies: replyItems.length,
      meetings: replyItems.filter((item) => Boolean(item.meetingStatus)).length,
      mailboxReady: degradedMailboxes === 0,
    });

    return {
      title: 'Operator command',
      subtitle:
        'One place to see pressure, movement, and what needs operator attention before the rest of the workspace.',
      pulse: {
        totals: overview?.totals ?? {},
        today: overview?.today ?? {},
        execution: overview?.execution ?? {},
        deliverability: {
          ...(overview?.deliverability ?? {}),
          healthyMailboxes,
          degradedMailboxes,
        },
      },
      attention: this.buildCommandAttention({
        alerts: alertItems as Array<Record<string, unknown>>,
        emailDispatches: emailDispatches as Array<Record<string, unknown>>,
        campaigns: campaignItems as Array<Record<string, unknown>>,
        inquiries: conversationItems as Array<Record<string, unknown>>,
      }),
      execution: {
        ...executionSurface,
        queuedJobs: overview?.execution?.queuedJobs ?? 0,
        failedJobs: failedJobItems.map((job) => ({
          id: job.id,
          type: job.type,
          status: job.status,
          error: job.lastError ?? '',
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          clientName: job.client?.displayName ?? job.client?.legalName ?? '',
          campaignName: job.campaign?.name ?? '',
        })),
        failedJobsCount: failedJobItems.length,
        emailDispatches,
      },
      outreach: {
        campaigns: campaignItems,
        meta: campaigns?.meta ?? null,
      },
      conversations: {
        inquiries: conversationItems,
        replies: replyItems,
        summary: publicInquiries?.summary ?? null,
      },
      clients: {
        items: clientItems,
        meta: clients?.meta ?? null,
      },
      health: {
        alerts: alertItems.map((alert) => ({
          id: alert.id,
          title: alert.title,
          severity: alert.severity,
          status: alert.status,
          category: alert.category,
          bodyText: alert.bodyText,
          createdAt: alert.createdAt,
          resolvedAt: alert.resolvedAt,
        })),
        summary: {
          open: alertItems.length,
          critical: alertItems.filter((alert) => alert.severity === 'CRITICAL').length,
          healthyMailboxes,
          degradedMailboxes,
        },
        deliverability: {
          ...deliverability,
          healthyMailboxes,
          degradedMailboxes,
        },
      },
    };
  }

  revenueOverview(organizationId: string) {
    return this.billingService.overview(organizationId);
  }

  async recordsOverview(organizationId: string) {
    const scopeOrganizationId = await this.resolveOperatorScope(organizationId);
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
      this.prisma.client.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.campaign.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.lead.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.reply.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.meeting.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.serviceAgreement.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.statement.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.reminderArtifact.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.template.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.alert.count({ where: scopeOrganizationId ? { organizationId: scopeOrganizationId } : undefined }),
      this.prisma.documentDispatch.count({
        where: { ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}), deliveryChannel: 'EMAIL' },
      }),
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

  async activityStream(
    organizationId: string,
    filters: { limit?: string; q?: string } = {},
  ) {
    const scopeOrganizationId = await this.resolveOperatorScope(organizationId);
    const parsedLimit = Number.parseInt(filters.limit ?? '', 10);
    const take = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 50;
    const q = filters.q?.trim();
    const where: Prisma.ActivityEventWhereInput = {
      ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}),
      ...(q
        ? {
            OR: [
              { summary: { contains: q, mode: 'insensitive' } },
              { subjectType: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, kindCounts, visibilityCounts] = await Promise.all([
      this.prisma.activityEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take,
        include: {
          client: { select: { id: true, displayName: true, legalName: true } },
          campaign: { select: { id: true, name: true, status: true } },
          actor: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.safeValue(() => this.prisma.activityEvent.groupBy({
        by: ['kind'],
        where,
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.activityEvent.groupBy({
        by: ['visibility'],
        where,
        _count: { _all: true },
      }), []),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        kind: item.kind,
        visibility: item.visibility,
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        summary: item.summary,
        createdAt: item.createdAt,
        clientId: item.clientId,
        campaignId: item.campaignId,
        workflowRunId: item.workflowRunId,
        actorUserId: item.actorUserId,
        clientName: item.client?.displayName ?? item.client?.legalName ?? '',
        campaignName: item.campaign?.name ?? '',
        campaignStatus: item.campaign?.status ?? '',
        actorName: item.actor?.fullName ?? item.actor?.email ?? '',
      })),
      summary: {
        total: items.length,
        byKind: this.countRowsToMap(kindCounts, 'kind'),
        byVisibility: this.countRowsToMap(visibilityCounts, 'visibility'),
        lastUpdatedAt: new Date(),
      },
    };
  }

  async executionWorkspace(
    organizationId: string,
    filters: { limit?: string } = {},
  ) {
    const scopeOrganizationId = await this.resolveOperatorScope(organizationId);
    const parsedLimit = Number.parseInt(filters.limit ?? '', 10);
    const take = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 50;
    const where: Prisma.JobWhereInput = scopeOrganizationId ? { organizationId: scopeOrganizationId } : {};

    const [jobs, statusCounts, queueCounts, typeCounts, recentRuns] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take,
        include: {
          client: { select: { id: true, displayName: true, legalName: true } },
          campaign: { select: { id: true, name: true, status: true } },
        },
      }),
      this.safeValue(() => this.prisma.job.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.job.groupBy({
        by: ['queueName'],
        where,
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.job.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
      }), []),
      this.safeValue(() => this.prisma.jobRun.findMany({
        where: {
          job: { is: where },
        },
        orderBy: [{ startedAt: 'desc' }],
        take: 20,
        include: {
          job: {
            select: {
              id: true,
              type: true,
              queueName: true,
              client: { select: { displayName: true, legalName: true } },
              campaign: { select: { name: true } },
            },
          },
        },
      }), []),
    ]);

    return {
      items: jobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        queueName: job.queueName,
        scheduledFor: job.scheduledFor,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        clientId: job.clientId,
        campaignId: job.campaignId,
        clientName: job.client?.displayName ?? job.client?.legalName ?? '',
        campaignName: job.campaign?.name ?? '',
        campaignStatus: job.campaign?.status ?? '',
      })),
      recentRuns: recentRuns.map((run) => ({
        id: run.id,
        jobId: run.jobId,
        runNumber: run.runNumber,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        errorMessage: run.errorMessage,
        type: run.job?.type,
        queueName: run.job?.queueName,
        clientName: run.job?.client?.displayName ?? run.job?.client?.legalName ?? '',
        campaignName: run.job?.campaign?.name ?? '',
      })),
      summary: {
        totalVisible: jobs.length,
        byStatus: this.countRowsToMap(statusCounts, 'status'),
        byQueue: this.countRowsToMap(queueCounts, 'queueName'),
        byType: this.countRowsToMap(typeCounts, 'type'),
        lastUpdatedAt: new Date(),
      },
    };
  }

  async listPublicInquiries(
    organizationId?: string,
    filters: { limit?: string; status?: string; q?: string } = {},
  ) {
    const parsedLimit = Number.parseInt(filters.limit ?? '', 10);
    const take = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    const where: Prisma.PublicInquiryWhereInput = this.buildInquiryWhere(organizationId);
    const normalizedStatus = this.parseStatus(filters.status);
    if (normalizedStatus) {
      where.status = normalizedStatus;
    }

    const q = filters.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, summary] = await Promise.all([
      this.prisma.publicInquiry.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { submittedAt: 'desc' }],
        take,
        include: {
          assignedTo: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
      this.inquirySummary(organizationId),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        company: item.company,
        inquiryType: item.inquiryType,
        type: this.humanizeInquiryType(item.inquiryType),
        status: item.status,
        message: item.message,
        submittedAt: item.submittedAt,
        createdAt: item.submittedAt,
        notifiedAt: item.notifiedAt,
        acknowledgedAt: item.acknowledgedAt,
        closedAt: item.closedAt,
        assignedToUserId: item.assignedToUserId,
        assignedToName: item.assignedTo?.fullName ?? '',
      isEscalated: item.isEscalated,
      escalationState: this.escalationState(item),
      slaState: this.slaState(item),
      firstResponseDueAt: item.firstResponseDueAt,
      nextResponseDueAt: item.nextResponseDueAt,
      lastActivityAt: item.lastActivityAt,
    })),
      summary,
    };
  }

  async getInquiryDetail(organizationId: string, inquiryId: string) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    return {
      id: inquiry.id,
      name: inquiry.name,
      email: inquiry.email,
      company: inquiry.company,
      inquiryType: inquiry.inquiryType,
      type: this.humanizeInquiryType(inquiry.inquiryType),
      status: inquiry.status,
      source: inquiry.source,
      message: inquiry.message,
      submittedAt: inquiry.submittedAt,
      createdAt: inquiry.submittedAt,
      notifiedAt: inquiry.notifiedAt,
      acknowledgedAt: inquiry.acknowledgedAt,
      closedAt: inquiry.closedAt,
      assignedToUserId: inquiry.assignedToUserId,
      assignedToName: inquiry.assignedTo?.fullName ?? '',
      assignedAt: inquiry.assignedAt,
      isEscalated: inquiry.isEscalated,
      escalationState: this.escalationState(inquiry),
      escalatedAt: inquiry.escalatedAt,
      slaState: this.slaState(inquiry),
      firstResponseDueAt: inquiry.firstResponseDueAt,
      nextResponseDueAt: inquiry.nextResponseDueAt,
      firstRespondedAt: inquiry.firstRespondedAt,
      lastInboundAt: inquiry.lastInboundAt,
      lastOutboundAt: inquiry.lastOutboundAt,
      lastActivityAt: inquiry.lastActivityAt,
      mailboxId: inquiry.mailboxId,
      externalThreadId: inquiry.externalThreadId,
      lastSyncedAt: inquiry.lastSyncedAt,
    };
  }

  async updateInquiryStatus(
    organizationId: string,
    inquiryId: string,
    dto: UpdateInquiryStatusDto,
    actorUserId: string,
  ) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    const status = dto.status;
    const now = new Date();

    const data: Prisma.PublicInquiryUpdateInput = {
      status,
      lastActivityAt: now,
      acknowledgedAt:
        status === PublicInquiryStatus.ACKNOWLEDGED ||
        status === PublicInquiryStatus.IN_PROGRESS
          ? inquiry.acknowledgedAt ?? now
          : inquiry.acknowledgedAt,
      firstRespondedAt:
        status === PublicInquiryStatus.IN_PROGRESS
          ? inquiry.firstRespondedAt ?? now
          : inquiry.firstRespondedAt,
      closedAt:
        status === PublicInquiryStatus.CLOSED || status === PublicInquiryStatus.SPAM
          ? now
          : null,
      isEscalated:
        status === PublicInquiryStatus.CLOSED || status === PublicInquiryStatus.SPAM
          ? false
          : inquiry.isEscalated,
      escalatedAt:
        status === PublicInquiryStatus.CLOSED || status === PublicInquiryStatus.SPAM
          ? null
          : inquiry.escalatedAt,
    };

    const updated = await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data,
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.SYSTEM,
        channel: InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.STATUS_CHANGE,
        bodyText: `Status changed to ${this.humanizeStatus(status)}.`,
        createdByUserId: actorUserId,
      },
    });
    structuredLog('info', 'support.status.changed', {
      inquiryId,
      actorUserId,
      status,
    });

    return {
      ok: true,
      inquiry: {
        id: updated.id,
        status: updated.status,
        acknowledgedAt: updated.acknowledgedAt,
        closedAt: updated.closedAt,
        assignedToName: updated.assignedTo?.fullName ?? '',
        lastActivityAt: updated.lastActivityAt,
      },
    };
  }

  async assignInquiry(
    organizationId: string,
    inquiryId: string,
    dto: AssignInquiryDto,
    actorUserId: string,
  ) {
    await this.requireInquiry(organizationId, inquiryId);
    const assignedToUserId = dto.assignedToUserId?.trim() || null;

    if (assignedToUserId) {
      const membership = await this.prisma.workspaceMember.findFirst({
        where: {
          organizationId,
          userId: assignedToUserId,
          isActive: true,
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      if (!membership) {
        throw new BadRequestException('Assigned user is not an active member of this organization');
      }
    }

    const now = new Date();
    const updated = await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data: {
        assignedToUserId,
        assignedAt: assignedToUserId ? now : null,
        lastActivityAt: now,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const assignmentText = updated.assignedTo
      ? `Assigned to ${updated.assignedTo.fullName || updated.assignedTo.email}.`
      : 'Assignment cleared.';

    await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.SYSTEM,
        channel: InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.ASSIGNMENT,
        bodyText: assignmentText,
        createdByUserId: actorUserId,
      },
    });
    structuredLog('info', 'support.assignment.changed', {
      inquiryId,
      actorUserId,
      assignedToUserId,
    });

    return {
      ok: true,
      inquiry: {
        id: updated.id,
        assignedToUserId: updated.assignedToUserId,
        assignedToName: updated.assignedTo?.fullName ?? '',
        assignedAt: updated.assignedAt,
        lastActivityAt: updated.lastActivityAt,
      },
    };
  }

  async getInquiryThread(organizationId: string, inquiryId: string) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    const messages = await this.prisma.inquiryMessage.findMany({
      where: { inquiryId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const initialMessage = {
      id: `initial:${inquiry.id}`,
      type: 'USER',
      content: inquiry.message,
      createdAt: inquiry.submittedAt,
      fromEmail: inquiry.email,
      toEmail: null,
      direction: InquiryDirection.INBOUND,
      channel: InquiryChannel.EMAIL,
      messageType: InquiryMessageType.CUSTOMER,
      authorName: inquiry.name,
      subjectLine: null,
    };

    return {
      messages: [
        initialMessage,
        ...messages.map((message) => ({
          id: message.id,
          type: this.timelineType(message),
          content: message.bodyText,
          createdAt: message.createdAt,
          fromEmail: message.fromEmail,
          toEmail: message.toEmail,
          direction: message.direction,
          channel: message.channel,
          messageType: message.messageType,
          authorName: message.createdBy?.fullName ?? '',
          subjectLine: message.subjectLine,
        })),
      ],
    };
  }

  async listInquiryNotes(organizationId: string, inquiryId: string) {
    await this.requireInquiry(organizationId, inquiryId);

    const notes = await this.prisma.inquiryNote.findMany({
      where: { inquiryId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    return notes.map((note) => ({
      id: note.id,
      bodyText: note.bodyText,
      content: note.bodyText,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      authorUserId: note.authorUserId,
      authorName: note.author?.fullName ?? '',
    }));
  }

  async createInquiryNote(
    organizationId: string,
    inquiryId: string,
    dto: CreateInquiryNoteDto,
    actorUserId: string,
  ) {
    await this.requireInquiry(organizationId, inquiryId);
    const bodyText = dto.bodyText.trim();
    const now = new Date();

    const note = await this.prisma.inquiryNote.create({
      data: {
        inquiryId,
        authorUserId: actorUserId,
        bodyText,
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data: { lastActivityAt: now },
    });

    await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.SYSTEM,
        channel: InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.NOTE,
        bodyText: 'Internal note added.',
        createdByUserId: actorUserId,
      },
    });
    structuredLog('info', 'support.note.created', {
      inquiryId,
      actorUserId,
    });

    return {
      id: note.id,
      bodyText: note.bodyText,
      content: note.bodyText,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      authorUserId: note.authorUserId,
      authorName: note.author?.fullName ?? '',
    };
  }

  async replyToInquiry(
    organizationId: string,
    inquiryId: string,
    dto: CreateInquiryReplyDto,
    actorUserId: string,
  ) {
    const inquiry = await this.requireInquiry(organizationId, inquiryId);
    const bodyText = dto.bodyText.trim();
    const now = new Date();

    const message = await this.prisma.inquiryMessage.create({
      data: {
        inquiryId,
        direction: InquiryDirection.OUTBOUND,
        channel: inquiry.mailboxId ? InquiryChannel.EMAIL : InquiryChannel.INTERNAL,
        messageType: InquiryMessageType.OPERATOR_REPLY,
        bodyText,
        fromEmail: inquiry.mailboxId ? undefined : null,
        toEmail: inquiry.email,
        mailboxId: inquiry.mailboxId,
        externalThreadId: inquiry.externalThreadId,
        createdByUserId: actorUserId,
        sentAt: dto.sendEmail ? now : null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const nextStatus =
      inquiry.status === PublicInquiryStatus.CLOSED || inquiry.status === PublicInquiryStatus.SPAM
        ? PublicInquiryStatus.IN_PROGRESS
        : inquiry.status === PublicInquiryStatus.NEW
          ? PublicInquiryStatus.IN_PROGRESS
          : inquiry.status;

    await this.prisma.publicInquiry.update({
      where: { id: inquiryId },
      data: {
        status: nextStatus,
        acknowledgedAt: inquiry.acknowledgedAt ?? now,
        firstRespondedAt: inquiry.firstRespondedAt ?? now,
        lastOutboundAt: now,
        lastActivityAt: now,
        closedAt: null,
        isEscalated: false,
        escalatedAt: null,
      },
    });
    structuredLog('info', 'support.operator.reply.created', {
      inquiryId,
      actorUserId,
      sendEmail: dto.sendEmail ?? false,
      status: nextStatus,
    });

    return {
      id: message.id,
      type: this.timelineType(message),
      content: message.bodyText,
      bodyText: message.bodyText,
      createdAt: message.createdAt,
      direction: message.direction,
      channel: message.channel,
      messageType: message.messageType,
      authorName: message.createdBy?.fullName ?? '',
      sendEmail: dto.sendEmail ?? false,
      emailBackflowReady: Boolean(inquiry.mailboxId),
      emailSent: false,
    };
  }

  private buildCommandAttention(input: {
    alerts: Array<Record<string, unknown>>;
    emailDispatches: Array<Record<string, unknown>>;
    campaigns: Array<Record<string, unknown>>;
    inquiries: Array<Record<string, unknown>>;
  }) {
    const items: Array<Record<string, unknown>> = [];

    for (const alert of input.alerts) {
      const resolved = alert['resolvedAt'] ?? alert['closedAt'] ?? null;
      if (resolved) continue;
      items.push({
        kind: 'alert',
        id: alert['id'] ?? null,
        title: this.safeString(alert['title']) || 'System alert',
        severity: this.safeString(alert['severity']) || 'warning',
      });
    }

    for (const dispatch of input.emailDispatches) {
      const status = this.safeString(dispatch['status']);
      if (!['FAILED', 'BOUNCED', 'BLOCKED'].includes(status)) continue;
      items.push({
        kind: 'email_dispatch',
        id: dispatch['id'] ?? null,
        title: 'Email dispatch needs review',
        severity: status === 'FAILED' ? 'critical' : 'warning',
        status,
      });
    }

    for (const campaign of input.campaigns) {
      const status = this.safeString(campaign['status']);
      if (status === 'ACTIVE') continue;
      items.push({
        kind: 'campaign',
        id: campaign['id'] ?? null,
        title: 'Campaign not active',
        severity: 'info',
        status,
      });
    }

    for (const inquiry of input.inquiries) {
      const status = this.safeString(inquiry['status']);
      if (status === 'CLOSED') continue;
      items.push({
        kind: 'inquiry',
        id: inquiry['id'] ?? null,
        title: this.safeString(inquiry['company'])
          || this.safeString(inquiry['name'])
          || 'Inquiry waiting',
        severity: status === 'ESCALATED' ? 'critical' : 'info',
        status,
      });
    }

    return items.slice(0, 20);
  }

  private async inquirySummary(organizationId?: string) {
    const where = this.buildInquiryWhere(organizationId);
    const [
      newCount,
      acknowledgedCount,
      inProgressCount,
      closedCount,
      spamCount,
      escalatedCount,
    ] = await Promise.all([
      this.prisma.publicInquiry.count({ where: { ...where, status: PublicInquiryStatus.NEW } }),
      this.prisma.publicInquiry.count({
        where: { ...where, status: PublicInquiryStatus.ACKNOWLEDGED },
      }),
      this.prisma.publicInquiry.count({
        where: { ...where, status: PublicInquiryStatus.IN_PROGRESS },
      }),
      this.prisma.publicInquiry.count({ where: { ...where, status: PublicInquiryStatus.CLOSED } }),
      this.prisma.publicInquiry.count({ where: { ...where, status: PublicInquiryStatus.SPAM } }),
      this.prisma.publicInquiry.count({ where: { ...where, isEscalated: true } }),
    ]);

    return {
      totalOpen: newCount + acknowledgedCount + inProgressCount,
      new: newCount,
      acknowledged: acknowledgedCount,
      inProgress: inProgressCount,
      closed: closedCount,
      spam: spamCount,
      escalated: escalatedCount,
    };
  }

  private async requireInquiry(organizationId: string, inquiryId: string) {
    const scopeOrganizationId = await this.resolveOperatorScope(organizationId);
    const inquiry = await this.prisma.publicInquiry.findFirst({
      where: {
        id: inquiryId,
        ...this.buildInquiryWhere(scopeOrganizationId),
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }

    return inquiry;
  }

  private async safeValue<T>(loader: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await loader();
    } catch (error) {
      console.warn('[OperatorService] operator truth query failed', error);
      return fallback;
    }
  }

  private countRowsToMap(rows: Array<Record<string, any>>, key: string) {
    return rows.reduce((result, row) => {
      const name = String(row[key] ?? 'UNKNOWN');
      result[name] = row._count?._all ?? 0;
      return result;
    }, {} as Record<string, number>);
  }

  private emptyControlOverview() {
    return {
      system: {
        phase: 'execution-core',
        posture: 'control unavailable',
      },
      totals: {
        organizations: 0,
        clients: 0,
        campaigns: 0,
        leads: 0,
        messages: 0,
        replies: 0,
        meetings: 0,
      },
      today: {
        sent: 0,
        replies: 0,
        booked: 0,
      },
      execution: {
        queuedJobs: 0,
        failedJobs: 0,
      },
      deliverability: {
        activeMailboxes: 0,
        degradedMailboxes: 0,
      },
      alerts: {
        open: 0,
      },
    };
  }

  private emptyInquirySummary() {
    return {
      totalOpen: 0,
      new: 0,
      acknowledged: 0,
      inProgress: 0,
      closed: 0,
      spam: 0,
      escalated: 0,
    };
  }

  private emptyDeliverabilityOverview() {
    return {
      domains: [],
      mailboxes: [],
      policies: [],
      suppressions: [],
      bounces: [],
      complaints: [],
    };
  }

  private async resolveOperatorScope(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true, isInternal: true },
    });

    if (!organization) {
      return organizationId;
    }

    if (organization.isInternal || organization.type === 'PLATFORM' || organization.type === 'INTERNAL') {
      return undefined;
    }

    return organizationId;
  }

  private buildInquiryWhere(organizationId?: string): Prisma.PublicInquiryWhereInput {
    if (!organizationId) return {};
    return {
      OR: [
        { client: { organizationId } },
        { clientId: null },
      ],
    };
  }

  private isHealthyMailbox(mailbox: { healthStatus?: MailboxHealthStatus | null }) {
    return mailbox.healthStatus !== MailboxHealthStatus.DEGRADED && mailbox.healthStatus !== MailboxHealthStatus.CRITICAL;
  }

  private isDegradedMailbox(mailbox: { healthStatus?: MailboxHealthStatus | null }) {
    return mailbox.healthStatus === MailboxHealthStatus.DEGRADED || mailbox.healthStatus === MailboxHealthStatus.CRITICAL;
  }

  private safeString(value: unknown) {
    return typeof value === 'string' ? value : String(value ?? '');
  }

  private parseStatus(status?: string) {
    const value = status?.trim().toUpperCase();
    if (!value) return undefined;
    const allowed = new Set<string>(Object.values(PublicInquiryStatusDto));
    return allowed.has(value) ? (value as PublicInquiryStatus) : undefined;
  }

  private humanizeInquiryType(value: string) {
    return value
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  private humanizeStatus(value: string) {
    return value
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  private escalationState(inquiry: {
    isEscalated?: boolean | null;
    escalatedAt?: Date | null;
    assignedToUserId?: string | null;
    status?: PublicInquiryStatus | string | null;
  }) {
    if (inquiry.status === PublicInquiryStatus.CLOSED || inquiry.status === PublicInquiryStatus.SPAM) {
      return 'cleared';
    }
    if (inquiry.isEscalated && inquiry.assignedToUserId) return 'assigned_escalation';
    if (inquiry.isEscalated) return 'unassigned_escalation';
    return 'standard';
  }

  private slaState(inquiry: {
    status?: PublicInquiryStatus | string | null;
    firstResponseDueAt?: Date | null;
    nextResponseDueAt?: Date | null;
    firstRespondedAt?: Date | null;
  }) {
    if (inquiry.status === PublicInquiryStatus.CLOSED || inquiry.status === PublicInquiryStatus.SPAM) {
      return 'closed';
    }
    const now = Date.now();
    const dueAt = inquiry.firstRespondedAt ? inquiry.nextResponseDueAt : inquiry.firstResponseDueAt;
    if (!dueAt) return 'not_set';
    const ms = new Date(dueAt).getTime() - now;
    if (ms < 0) return 'breached';
    if (ms <= 60 * 60 * 1000) return 'due_soon';
    return 'on_track';
  }

  private timelineType(message: {
    direction: InquiryDirection;
    messageType: InquiryMessageType;
  }) {
    if (message.messageType === InquiryMessageType.OPERATOR_REPLY) return 'OPERATOR';
    if (message.direction === InquiryDirection.SYSTEM) return 'SYSTEM';
    return 'USER';
  }
}
