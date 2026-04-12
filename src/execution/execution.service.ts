import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityVisibility,
  JobStatus,
  JobType,
  LeadQualificationState,
  LeadStatus,
  Mailbox,
  MeetingStatus,
  MessageLifecycle,
  MessageStatus,
  Prisma,
  RecordSource,
  ReplyIntent,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { DeliverabilityService } from '../deliverability/deliverability.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { AiService } from '../ai/ai.service';
import { DispatchDueJobsDto } from './dto/dispatch-due-jobs.dto';
import { QueueLeadSendDto } from './dto/queue-lead-send.dto';
import { RunJobDto } from './dto/run-job.dto';

@Injectable()
export class ExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliverabilityService: DeliverabilityService,
    private readonly workflowsService: WorkflowsService,
    private readonly aiService: AiService,
  ) {}

  async queueLeadSend(leadId: string, dto: QueueLeadSendDto) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { campaign: true, client: true, contact: true, account: true },
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    const jobType = dto.jobType ?? JobType.FIRST_SEND;
    const scheduledFor = dto.scheduledFor ?? new Date();
    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: lead.clientId,
      campaignId: lead.campaignId,
      lane: WorkflowLane.GROWTH,
      type: this.resolveWorkflowType(jobType),
      status: WorkflowStatus.PENDING,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.SYSTEM_GENERATED,
      title: `${jobType === JobType.FOLLOWUP_SEND ? 'Follow-up' : 'First send'} for ${lead.contact?.email || lead.account?.companyName || lead.id}`,
      inputJson: {
        leadId: lead.id,
        jobType,
        simulateDeliveryOnly: dto.simulateDeliveryOnly ?? false,
        scheduledFor: scheduledFor.toISOString(),
        note: dto.note ?? null,
        metadataJson: dto.metadataJson ?? null,
      },
      contextJson: {
        campaignId: lead.campaignId,
        existingCampaignWorkflowRunId: lead.campaign?.workflowRunId ?? null,
      },
    });
    const dedupeKey = `${jobType}:${lead.id}:${scheduledFor.toISOString().slice(0, 16)}`;

    const existing = await this.prisma.job.findFirst({
      where: {
        dedupeKey,
        status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED] },
      },
    });
    if (existing) {
      await this.workflowsService.markWorkflowWaiting(workflow.id, {
        dedupedToJobId: existing.id,
        dedupeKey,
      });
      return { ok: true, deduped: true, jobId: existing.id, workflowRunId: workflow.id };
    }

    const job = await this.prisma.job.create({
      data: {
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        campaignId: lead.campaignId,
        type: jobType,
        status: JobStatus.QUEUED,
        queueName: jobType === JobType.FOLLOWUP_SEND ? 'followup' : 'outreach',
        dedupeKey,
        scheduledFor,
        maxAttempts: dto.maxAttempts ?? 3,
        payloadJson: {
          leadId: lead.id,
          workflowRunId: workflow.id,
          simulateDeliveryOnly: dto.simulateDeliveryOnly ?? false,
          note: dto.note,
          metadataJson: dto.metadataJson ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        campaignId: lead.campaignId,
        workflowRunId: workflow.id,
        kind: 'LEAD_UPDATED',
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'job',
        subjectId: job.id,
        summary: `${job.type} queued for ${lead.contact?.email || lead.account?.companyName || lead.id}`,
        metadataJson: {
          leadId: lead.id,
          jobId: job.id,
          workflowRunId: workflow.id,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      ok: true,
      jobId: job.id,
      workflowRunId: workflow.id,
      leadId: lead.id,
      scheduledFor,
      type: job.type,
      queueName: job.queueName,
    };
  }

  async dispatchDueJobs(dto: DispatchDueJobsDto) {
    const limit = dto.limit ?? 25;
    const jobs = await this.prisma.job.findMany({
      where: {
        ...(dto.organizationId ? { organizationId: dto.organizationId } : {}),
        status: {
          in: dto.includeRetryScheduled ? [JobStatus.QUEUED, JobStatus.RETRY_SCHEDULED] : [JobStatus.QUEUED],
        },
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });

    if (dto.dryRun) {
      return {
        ok: true,
        dryRun: true,
        count: jobs.length,
        jobs: jobs.map((job) => ({ id: job.id, type: job.type, status: job.status, queueName: job.queueName })),
      };
    }

    const results: Awaited<ReturnType<ExecutionService['runJob']>>[] = [];
    for (const job of jobs) {
      results.push(await this.runJob(job.id, { dryRun: false }));
    }

    return {
      ok: true,
      dispatched: results.length,
      results,
    };
  }

  async runJob(jobId: string, dto: RunJobDto = {}) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const payload = ((job.payloadJson ?? {}) as Record<string, unknown>) || {};
    const workflowRunId = typeof payload.workflowRunId === 'string' ? payload.workflowRunId : undefined;

    if (dto.dryRun) {
      return {
        ok: true,
        dryRun: true,
        job: {
          id: job.id,
          type: job.type,
          status: job.status,
          queueName: job.queueName,
          scheduledFor: job.scheduledFor,
          workflowRunId,
        },
      };
    }

    if (job.status !== JobStatus.QUEUED && job.status !== JobStatus.RETRY_SCHEDULED) {
      throw new BadRequestException(`Job ${job.id} is not runnable from status ${job.status}`);
    }

    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });

    if (workflowRunId) {
      await this.workflowsService.startWorkflowRun(workflowRunId, {
        jobId: job.id,
        jobType: job.type,
        queueName: job.queueName,
      });
    }

    try {
      let result: Record<string, unknown>;
      if (job.type === JobType.FIRST_SEND || job.type === JobType.FOLLOWUP_SEND) {
        const leadId = String(payload.leadId || '');
        result = await this.runImmediateSendForLead(leadId, {
          jobId: job.id,
          workflowRunId,
          jobType: job.type,
          simulateDeliveryOnly: Boolean(payload.simulateDeliveryOnly),
          note: typeof payload.note === 'string' ? payload.note : undefined,
        });
      } else if (job.type === JobType.MAILBOX_HEALTH_CHECK) {
        result = await this.deliverabilityService.refreshMailboxHealth(String(payload.mailboxId || ''));
      } else if (job.type === JobType.LEAD_IMPORT) {
        if (!job.clientId) {
          throw new BadRequestException(`Job ${job.id} is missing clientId`);
        }
        result = await this.runLeadImportBootstrap(
          {
            id: job.id,
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId,
          },
          payload,
          workflowRunId,
        );
      } else if (job.type === JobType.INVOICE_GENERATION) {
        if (!job.clientId) {
          throw new BadRequestException(`Job ${job.id} is missing clientId`);
        }
        result = await this.runRevenueBootstrap(
          {
            id: job.id,
            organizationId: job.organizationId,
            clientId: job.clientId,
            campaignId: job.campaignId,
          },
          payload,
          workflowRunId,
        );
      } else if (job.type === JobType.REPLY_CLASSIFICATION) {
        result = await this.runReplyClassification(String(payload.replyId || ''), {
          workflowRunId,
          jobId: job.id,
        });
      } else if (job.type === JobType.MEETING_HANDOFF) {
        result = await this.runMeetingHandoff(String(payload.replyId || ''), {
          workflowRunId,
          jobId: job.id,
        });
      } else {
        result = {
          skipped: true,
          reason: `No executor implemented yet for ${job.type}`,
        };
      }

      await this.prisma.jobRun.create({
        data: {
          jobId: job.id,
          workflowRunId,
          runNumber: (job.attemptCount || 0) + 1,
          status: JobStatus.SUCCEEDED,
          startedAt: job.startedAt ?? new Date(),
          finishedAt: new Date(),
          logJson: result as Prisma.InputJsonValue,
        },
      });

      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.SUCCEEDED,
          finishedAt: new Date(),
          resultJson: result as Prisma.InputJsonValue,
          lastError: null,
        },
      });

      if (workflowRunId) {
        await this.workflowsService.completeWorkflowRun(workflowRunId, {
          jobId: job.id,
          jobType: job.type,
          result,
        });
      }

      return {
        ok: true,
        jobId: job.id,
        workflowRunId,
        status: JobStatus.SUCCEEDED,
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown execution error';
      const shouldRetry = job.attemptCount + 1 < job.maxAttempts;
      const retryAt = shouldRetry ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await this.prisma.jobRun.create({
        data: {
          jobId: job.id,
          workflowRunId,
          runNumber: (job.attemptCount || 0) + 1,
          status: shouldRetry ? JobStatus.RETRY_SCHEDULED : JobStatus.FAILED,
          startedAt: job.startedAt ?? new Date(),
          finishedAt: new Date(),
          errorMessage: message,
        },
      });

      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: shouldRetry ? JobStatus.RETRY_SCHEDULED : JobStatus.FAILED,
          finishedAt: shouldRetry ? null : new Date(),
          scheduledFor: retryAt,
          lastError: message,
        },
      });

      if (workflowRunId) {
        if (shouldRetry) {
          await this.workflowsService.markWorkflowWaiting(workflowRunId, {
            jobId: job.id,
            error: message,
            retryAt: retryAt?.toISOString() ?? null,
          });
        } else {
          await this.workflowsService.failWorkflowRun(workflowRunId, {
            jobId: job.id,
            error: message,
          });
        }
      }

      return {
        ok: false,
        jobId: job.id,
        workflowRunId,
        status: shouldRetry ? JobStatus.RETRY_SCHEDULED : JobStatus.FAILED,
        retryAt,
        error: message,
      };
    }
  }

  async runImmediateSendForLead(
    leadId: string,
    input: {
      jobId?: string;
      workflowRunId?: string;
      jobType: JobType;
      simulateDeliveryOnly?: boolean;
      note?: string;
    },
  ) {
    const standaloneWorkflowRunId = input.workflowRunId
      ? undefined
      : (
          await this.workflowsService.createWorkflowRun({
            clientId: await this.resolveClientId(leadId),
            lane: WorkflowLane.GROWTH,
            type: this.resolveWorkflowType(input.jobType),
            status: WorkflowStatus.RUNNING,
            trigger: WorkflowTrigger.USER_ACTION,
            source: RecordSource.SYSTEM_GENERATED,
            title: `Immediate ${input.jobType === JobType.FOLLOWUP_SEND ? 'follow-up' : 'send'} for ${leadId}`,
            inputJson: {
              leadId,
              jobType: input.jobType,
              simulateDeliveryOnly: input.simulateDeliveryOnly ?? false,
              note: input.note ?? null,
            },
            startedAt: new Date(),
          })
        ).id;

    const workflowRunId = input.workflowRunId ?? standaloneWorkflowRunId;

    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          account: true,
          contact: true,
          campaign: true,
          client: true,
        },
      });
      if (!lead) {
        throw new NotFoundException(`Lead ${leadId} not found`);
      }

      const email = lead.contact?.email?.trim().toLowerCase();
      if (!email) {
        throw new BadRequestException(`Lead ${leadId} has no contact email`);
      }

      const suppression = await this.deliverabilityService.findSuppressionForRecipient({
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        emailAddress: email,
      });
      if (suppression) {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: LeadStatus.SUPPRESSED,
            qualificationState: LeadQualificationState.DISQUALIFIED,
            suppressionReason: suppression.reason || suppression.type,
          },
        });

        if (workflowRunId && standaloneWorkflowRunId) {
          await this.workflowsService.completeWorkflowRun(workflowRunId, {
            leadId: lead.id,
            suppressed: true,
            suppressionId: suppression.id,
          });
        }

        return {
          ok: false,
          suppressed: true,
          leadId: lead.id,
          suppressionId: suppression.id,
          workflowRunId,
        };
      }

      const mailbox = await this.deliverabilityService.pickMailboxForClient({
        organizationId: lead.organizationId,
        clientId: lead.clientId,
      });
      if (!mailbox) {
        throw new BadRequestException(`No active mailbox available for lead ${lead.id}`);
      }

      const policyCheck = await this.deliverabilityService.assertCanSendNow({
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        campaignId: lead.campaignId,
        mailbox,
      });
      if (!policyCheck.allowed) {
        throw new BadRequestException(policyCheck.reason || 'Mailbox blocked by send policy');
      }

      const body = this.buildMessageBody(lead, input.jobType, input.note);
      const subject = this.buildMessageSubject(lead, input.jobType);
      const lifecycle = input.simulateDeliveryOnly ? MessageLifecycle.SCHEDULED : MessageLifecycle.DISPATCHED;
      const status = input.simulateDeliveryOnly ? MessageStatus.SCHEDULED : MessageStatus.SENT;

      const message = await this.prisma.outreachMessage.create({
        data: {
          organizationId: lead.organizationId,
          clientId: lead.clientId,
          campaignId: lead.campaignId,
          leadId: lead.id,
          mailboxId: mailbox.id,
          workflowRunId,
          direction: 'OUTBOUND',
          channel: 'EMAIL',
          status,
          source: RecordSource.SYSTEM_GENERATED,
          lifecycle,
          subjectLine: subject,
          bodyText: body,
          sentAt: input.simulateDeliveryOnly ? null : new Date(),
          metadataJson: {
            simulateDeliveryOnly: input.simulateDeliveryOnly ?? false,
            mailboxEmail: mailbox.emailAddress,
            jobType: input.jobType,
            workflowRunId,
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: input.jobType === JobType.FOLLOWUP_SEND ? LeadStatus.FOLLOWED_UP : LeadStatus.CONTACTED,
          qualificationState: LeadQualificationState.CONTACTED,
          firstContactAt: lead.firstContactAt ?? new Date(),
          lastContactAt: new Date(),
        },
      });

      await this.prisma.campaign.update({
        where: { id: lead.campaignId },
        data: {
          generationState: 'ACTIVE',
        },
      });

      await this.prisma.activityEvent.create({
        data: {
          organizationId: lead.organizationId,
          clientId: lead.clientId,
          campaignId: lead.campaignId,
          workflowRunId,
          kind: 'MESSAGE_SENT',
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'outreach_message',
          subjectId: message.id,
          summary: `${input.jobType === JobType.FOLLOWUP_SEND ? 'Follow-up' : 'First send'} issued to ${email}`,
          metadataJson: {
            leadId: lead.id,
            messageId: message.id,
            mailboxId: mailbox.id,
            workflowRunId,
            lifecycle,
          } as Prisma.InputJsonValue,
        },
      });

      if (!input.simulateDeliveryOnly && input.jobType === JobType.FIRST_SEND) {
        await this.ensureFollowUpQueued(lead, workflowRunId);
      }

      if (workflowRunId && standaloneWorkflowRunId) {
        await this.workflowsService.completeWorkflowRun(workflowRunId, {
          leadId: lead.id,
          messageId: message.id,
          mailboxId: mailbox.id,
          lifecycle,
          simulateDeliveryOnly: input.simulateDeliveryOnly ?? false,
        });
      }

      return {
        ok: true,
        leadId: lead.id,
        messageId: message.id,
        mailboxId: mailbox.id,
        mailbox: mailbox.emailAddress,
        workflowRunId,
        status: input.jobType === JobType.FOLLOWUP_SEND ? LeadStatus.FOLLOWED_UP : LeadStatus.CONTACTED,
        simulateDeliveryOnly: input.simulateDeliveryOnly ?? false,
        jobId: input.jobId,
      };
    } catch (error) {
      if (standaloneWorkflowRunId) {
        const message = error instanceof Error ? error.message : 'Unknown execution error';
        await this.workflowsService.failWorkflowRun(standaloneWorkflowRunId, {
          leadId,
          error: message,
        });
      }
      throw error;
    }
  }

  private async runLeadImportBootstrap(
    job: { id: string; organizationId: string; clientId: string; campaignId: string | null },
    payload: Record<string, unknown>,
    workflowRunId?: string,
  ) {
    const campaignId = this.readString(payload.campaignId) ?? job.campaignId;
    if (!campaignId) {
      throw new BadRequestException(`Activation job ${job.id} is missing a campaignId`);
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { client: true },
    });
    if (!campaign) {
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    }

    const existingSendableLeads = await this.prisma.lead.findMany({
      where: {
        campaignId: campaign.id,
        status: { in: [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED] },
        contact: { email: { not: null } },
      },
      select: { id: true },
      take: 25,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    let createdLeadIds: string[] = [];

    if (!existingSendableLeads.length) {
      createdLeadIds = await this.bootstrapLeadsFromClientAssets({
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        workflowRunId,
      });
    }

    const sendableLeadIds = existingSendableLeads.map((item) => item.id);
    const candidateLeadIds = [...sendableLeadIds, ...createdLeadIds].slice(0, 10);

    if (!candidateLeadIds.length) {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          generationState: 'TARGETING_READY',
          metadataJson: toPrismaJson({
            ...this.asObject(campaign.metadataJson),
            activation: {
              lastBootstrapAt: new Date().toISOString(),
              bootstrapStatus: 'awaiting_lead_source',
              bootstrapReason: 'No contacts or seed prospects were available for automatic launch.',
            },
          }),
        },
      });

      return {
        ok: true,
        createdLeadCount: createdLeadIds.length,
        queuedFirstSendCount: 0,
        campaignId: campaign.id,
        waitingForLeadSource: true,
      };
    }

    const queuedJobs: string[] = [];
    for (const leadId of candidateLeadIds) {
      const queued = await this.queueLeadSend(leadId, {
        jobType: JobType.FIRST_SEND,
        maxAttempts: 3,
        note: 'automatic launch from subscription activation',
      });
      if (!queued.deduped && queued.jobId) {
        queuedJobs.push(String(queued.jobId));
      }
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'ACTIVE',
        generationState: 'ACTIVE',
        metadataJson: toPrismaJson({
          ...this.asObject(campaign.metadataJson),
          activation: {
            lastBootstrapAt: new Date().toISOString(),
            bootstrapStatus: 'launch_queued',
            createdLeadCount: createdLeadIds.length,
            queuedFirstSendCount: queuedJobs.length,
          },
        }),
      },
    });

    return {
      ok: true,
      campaignId: campaign.id,
      createdLeadCount: createdLeadIds.length,
      queuedFirstSendCount: queuedJobs.length,
      queuedJobIds: queuedJobs,
    };
  }

  private async runRevenueBootstrap(
    job: { id: string; organizationId: string; clientId: string; campaignId: string | null },
    payload: Record<string, unknown>,
    workflowRunId?: string,
  ) {
    const metadata = this.asObject(payload.metadataJson);
    return {
      ok: true,
      revenueBootstrapReady: true,
      jobId: job.id,
      workflowRunId,
      note: 'Revenue activation is live. Billing continuity is available and growth activation is handled by lead bootstrap jobs.',
      metadata,
    };
  }

  private async bootstrapLeadsFromClientAssets(input: {
    organizationId: string;
    clientId: string;
    campaignId: string;
    workflowRunId?: string;
  }) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        email: { not: null },
      },
      include: {
        account: true,
        leads: {
          where: { campaignId: input.campaignId },
          select: { id: true },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 25,
    });

    const createdLeadIds: string[] = [];

    for (const contact of contacts) {
      if (contact.leads.length) continue;
      const lead = await this.prisma.lead.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: input.campaignId,
          accountId: contact.accountId ?? undefined,
          contactId: contact.id,
          workflowRunId: input.workflowRunId,
          status: LeadStatus.NEW,
          source: RecordSource.IMPORTED,
          qualificationState: LeadQualificationState.DISCOVERED,
          priority: 50,
          metadataJson: toPrismaJson({
            source: 'subscription-activation-existing-contact',
          }),
        },
      });
      createdLeadIds.push(lead.id);
    }

    if (createdLeadIds.length) {
      return createdLeadIds;
    }

    const client = await this.prisma.client.findUnique({
      where: { id: input.clientId },
      select: {
        metadataJson: true,
        scopeJson: true,
        industry: true,
      },
    });
    const metadata = this.asObject(client?.metadataJson);
    const setup = this.asObject(metadata.setup);
    const scope = this.asObject(client?.scopeJson);
    const seedProspects = this.readSeedProspects(
      setup.seedProspects ?? metadata.seedProspects ?? scope.seedProspects,
    );

    for (const prospect of seedProspects.slice(0, 25)) {
      const existing = await this.prisma.contact.findFirst({
        where: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          email: prospect.email,
        },
        select: { id: true, accountId: true },
      });

      let accountId = existing?.accountId ?? null;
      let contactId = existing?.id ?? null;

      if (!accountId && prospect.companyName) {
        const account = await this.prisma.account.create({
          data: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            companyName: prospect.companyName,
            domain: prospect.domain,
            industry: prospect.industry ?? client?.industry ?? undefined,
            city: prospect.city,
            region: prospect.region,
            countryCode: prospect.countryCode,
            websiteUrl: prospect.websiteUrl,
            linkedinUrl: prospect.linkedinUrl,
          },
        });
        accountId = account.id;
      }

      if (!contactId) {
        const contact = await this.prisma.contact.create({
          data: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            accountId: accountId ?? undefined,
            fullName: prospect.fullName,
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            title: prospect.title,
            email: prospect.email,
            phone: prospect.phone,
            linkedinUrl: prospect.linkedinUrl,
            timezone: prospect.timezone,
            city: prospect.city,
            region: prospect.region,
            countryCode: prospect.countryCode,
          },
        });
        contactId = contact.id;
      }

      const lead = await this.prisma.lead.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: input.campaignId,
          accountId: accountId ?? undefined,
          contactId: contactId ?? undefined,
          workflowRunId: input.workflowRunId,
          status: LeadStatus.NEW,
          source: RecordSource.AI_GENERATED,
          qualificationState: LeadQualificationState.DISCOVERED,
          priority: prospect.priority ?? 60,
          score: prospect.score == null ? undefined : new Prisma.Decimal(prospect.score),
          metadataJson: toPrismaJson({
            source: 'subscription-activation-seed-prospect',
            origin: prospect.origin ?? 'client_metadata',
          }),
        },
      });
      createdLeadIds.push(lead.id);
    }

    if (createdLeadIds.length) {
      return createdLeadIds;
    }

    const aiBootstrap = await this.aiService.bootstrapCampaignActivation({
      clientId: input.clientId,
      campaignId: input.campaignId,
      workflowRunId: input.workflowRunId,
      workflowTitle: 'Automatic client launch',
    });

    return aiBootstrap.sendableLeadIds ?? [];
  }

  private async ensureFollowUpQueued(
    lead: {
      id: string;
      organizationId: string;
      clientId: string;
      campaignId: string;
    },
    workflowRunId?: string,
  ) {
    const scheduledFor = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const dedupeKey = `${JobType.FOLLOWUP_SEND}:${lead.id}:${scheduledFor.toISOString().slice(0, 10)}`;

    const existing = await this.prisma.job.findFirst({
      where: {
        type: JobType.FOLLOWUP_SEND,
        campaignId: lead.campaignId,
        clientId: lead.clientId,
        status: { in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED] },
        OR: [{ dedupeKey }, { payloadJson: { path: ['leadId'], equals: lead.id } }],
      },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    const job = await this.prisma.job.create({
      data: {
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        campaignId: lead.campaignId,
        type: JobType.FOLLOWUP_SEND,
        status: JobStatus.QUEUED,
        queueName: 'followup',
        dedupeKey,
        scheduledFor,
        maxAttempts: 3,
        payloadJson: toPrismaJson({
          leadId: lead.id,
          workflowRunId,
          note: 'automatic follow-up after first send',
        }),
      },
    });

    return job.id;
  }


  async runReplyClassification(
    replyId: string,
    input: {
      workflowRunId?: string;
      jobId?: string;
    } = {},
  ) {
    if (!replyId) {
      throw new BadRequestException('Reply id is required for classification');
    }

    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      include: {
        lead: {
          include: {
            client: true,
            campaign: true,
            contact: true,
            account: true,
          },
        },
        client: true,
        campaign: true,
      },
    });

    if (!reply) {
      throw new NotFoundException(`Reply ${replyId} not found`);
    }

    const standaloneWorkflowRunId = input.workflowRunId
      ? undefined
      : (
          await this.workflowsService.createWorkflowRun({
            clientId: reply.clientId,
            campaignId: reply.campaignId,
            lane: WorkflowLane.GROWTH,
            type: WorkflowType.REPLY_PROCESSING,
            status: WorkflowStatus.RUNNING,
            trigger: WorkflowTrigger.SYSTEM_EVENT,
            source: RecordSource.EXTERNAL_SYNC,
            title: `Reply classification for ${reply.fromEmail || reply.id}`,
            inputJson: {
              replyId: reply.id,
              fromEmail: reply.fromEmail,
            },
            startedAt: new Date(),
          })
        ).id;

    const workflowRunId = input.workflowRunId ?? standaloneWorkflowRunId;
    const classification = this.classifyReplyIntent({
      subjectLine: reply.subjectLine,
      bodyText: reply.bodyText,
    });

    const updatedReply = await this.prisma.reply.update({
      where: { id: reply.id },
      data: {
        workflowRunId,
        intent: classification.intent,
        confidence: new Prisma.Decimal(classification.confidence.toFixed(2)),
        requiresHumanReview: classification.requiresHumanReview,
        handledAt:
          classification.intent === ReplyIntent.INTERESTED ||
          classification.intent === ReplyIntent.REFERRAL ||
          classification.intent === ReplyIntent.UNSUBSCRIBE ||
          classification.intent === ReplyIntent.NOT_NOW ||
          classification.intent === ReplyIntent.NOT_RELEVANT
            ? new Date()
            : null,
        metadataJson: toPrismaJson({
          ...(this.asObject(reply.metadataJson) as Record<string, unknown>),
          classification: {
            intent: classification.intent,
            confidence: classification.confidence,
            requiresHumanReview: classification.requiresHumanReview,
            matchedSignals: classification.matchedSignals,
            classifiedAt: new Date().toISOString(),
          },
        }),
      },
    });

    let nextLeadStatus: LeadStatus | null = null;
    let nextQualification: LeadQualificationState | null = null;
    if (classification.intent === ReplyIntent.INTERESTED || classification.intent === ReplyIntent.REFERRAL) {
      nextLeadStatus = LeadStatus.INTERESTED;
      nextQualification = LeadQualificationState.INTERESTED;
    } else if (classification.intent === ReplyIntent.NOT_NOW || classification.intent === ReplyIntent.NOT_RELEVANT) {
      nextLeadStatus = LeadStatus.REPLIED;
      nextQualification = LeadQualificationState.REPLIED;
    } else if (classification.intent === ReplyIntent.UNSUBSCRIBE) {
      nextLeadStatus = LeadStatus.SUPPRESSED;
      nextQualification = LeadQualificationState.DISQUALIFIED;
    } else if (classification.intent === ReplyIntent.OOO || classification.intent === ReplyIntent.UNCLEAR) {
      nextLeadStatus = LeadStatus.REPLIED;
      nextQualification = LeadQualificationState.REPLIED;
    }

    if (nextLeadStatus && nextQualification) {
      await this.prisma.lead.update({
        where: { id: reply.leadId },
        data: {
          status: nextLeadStatus,
          qualificationState: nextQualification,
          lastContactAt: new Date(),
          suppressionReason:
            classification.intent === ReplyIntent.UNSUBSCRIBE
              ? 'unsubscribe_reply'
              : undefined,
        },
      });
    }

    await this.prisma.activityEvent.create({
      data: {
        organizationId: reply.organizationId,
        clientId: reply.clientId,
        campaignId: reply.campaignId,
        workflowRunId,
        kind: 'REPLY_RECEIVED',
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'reply',
        subjectId: reply.id,
        summary: `Reply classified as ${classification.intent.toLowerCase()}`,
        metadataJson: toPrismaJson({
          replyId: reply.id,
          intent: classification.intent,
          confidence: classification.confidence,
          requiresHumanReview: classification.requiresHumanReview,
        }),
      },
    });

    let handoffJobId: string | null = null;
    if (classification.intent === ReplyIntent.INTERESTED || classification.intent === ReplyIntent.REFERRAL) {
      const dedupeKey = `meeting_handoff:${reply.id}`;
      const existingJob = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: {
            in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED],
          },
        },
        select: { id: true },
      });

      if (!existingJob) {
        const job = await this.prisma.job.create({
          data: {
            organizationId: reply.organizationId,
            clientId: reply.clientId,
            campaignId: reply.campaignId,
            type: JobType.MEETING_HANDOFF,
            status: JobStatus.QUEUED,
            queueName: 'meetings',
            dedupeKey,
            scheduledFor: new Date(),
            maxAttempts: 3,
            payloadJson: toPrismaJson({
              replyId: reply.id,
              workflowRunId,
            }),
          },
        });
        handoffJobId = job.id;
      } else {
        handoffJobId = existingJob.id;
      }
    }

    if (workflowRunId && standaloneWorkflowRunId) {
      await this.workflowsService.completeWorkflowRun(workflowRunId, {
        replyId: reply.id,
        intent: classification.intent,
        confidence: classification.confidence,
        handoffJobId,
      });
    }

    return {
      ok: true,
      replyId: reply.id,
      intent: updatedReply.intent,
      confidence: classification.confidence,
      requiresHumanReview: classification.requiresHumanReview,
      handoffJobId,
      workflowRunId,
      jobId: input.jobId,
    };
  }

  async runMeetingHandoff(
    replyId: string,
    input: {
      workflowRunId?: string;
      jobId?: string;
    } = {},
  ) {
    if (!replyId) {
      throw new BadRequestException('Reply id is required for meeting handoff');
    }

    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      include: {
        lead: {
          include: {
            client: true,
            campaign: true,
            contact: true,
            account: true,
          },
        },
        campaign: true,
        client: true,
        meeting: true,
      },
    });

    if (!reply) {
      throw new NotFoundException(`Reply ${replyId} not found`);
    }

    if (reply.intent !== ReplyIntent.INTERESTED && reply.intent !== ReplyIntent.REFERRAL) {
      return {
        ok: true,
        skipped: true,
        reason: 'reply_not_meeting_eligible',
        replyId: reply.id,
      };
    }

    const standaloneWorkflowRunId = input.workflowRunId
      ? undefined
      : (
          await this.workflowsService.createWorkflowRun({
            clientId: reply.clientId,
            campaignId: reply.campaignId,
            lane: WorkflowLane.GROWTH,
            type: WorkflowType.MEETING_CONVERSION,
            status: WorkflowStatus.RUNNING,
            trigger: WorkflowTrigger.SYSTEM_EVENT,
            source: RecordSource.EXTERNAL_SYNC,
            title: `Meeting handoff for ${reply.fromEmail || reply.id}`,
            inputJson: {
              replyId: reply.id,
              intent: reply.intent,
            },
            startedAt: new Date(),
          })
        ).id;

    const workflowRunId = input.workflowRunId ?? standaloneWorkflowRunId;
    const bookingUrl =
      reply.campaign?.bookingUrlOverride ||
      reply.lead?.client?.bookingUrl ||
      null;

    const title = `Meeting request · ${reply.lead?.account?.companyName || reply.fromEmail || 'Prospect'}`;

    const meeting = reply.meeting
      ? await this.prisma.meeting.update({
          where: { id: reply.meeting.id },
          data: {
            workflowRunId,
            status: bookingUrl ? MeetingStatus.PROPOSED : MeetingStatus.PROPOSED,
            bookingUrl,
            title,
            notesText: this.buildMeetingNotes(reply),
            metadataJson: toPrismaJson({
              ...(this.asObject(reply.meeting.metadataJson) as Record<string, unknown>),
              handoffAt: new Date().toISOString(),
              source: 'reply_automation',
            }),
          },
        })
      : await this.prisma.meeting.create({
          data: {
            organizationId: reply.organizationId,
            clientId: reply.clientId,
            campaignId: reply.campaignId,
            leadId: reply.leadId,
            replyId: reply.id,
            workflowRunId,
            status: MeetingStatus.PROPOSED,
            source: RecordSource.SYSTEM_GENERATED,
            title,
            bookingUrl,
            notesText: this.buildMeetingNotes(reply),
            metadataJson: toPrismaJson({
              source: 'reply_automation',
              replyIntent: reply.intent,
              handoffAt: new Date().toISOString(),
            }),
          },
        });

    await this.prisma.lead.update({
      where: { id: reply.leadId },
      data: {
        status: LeadStatus.BOOKED,
        qualificationState: LeadQualificationState.CONVERTED,
        lastContactAt: new Date(),
      },
    });

    await this.prisma.reply.update({
      where: { id: reply.id },
      data: {
        handledAt: new Date(),
        requiresHumanReview: bookingUrl ? false : true,
        workflowRunId,
      },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: reply.organizationId,
        clientId: reply.clientId,
        campaignId: reply.campaignId,
        workflowRunId,
        kind: 'MEETING_BOOKED',
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'meeting',
        subjectId: meeting.id,
        summary: bookingUrl
          ? 'Meeting handoff prepared with booking link.'
          : 'Interested reply converted into a meeting handoff requiring review.',
        metadataJson: toPrismaJson({
          meetingId: meeting.id,
          replyId: reply.id,
          bookingUrl,
        }),
      },
    });

    if (workflowRunId && standaloneWorkflowRunId) {
      await this.workflowsService.completeWorkflowRun(workflowRunId, {
        replyId: reply.id,
        meetingId: meeting.id,
        bookingUrl,
      });
    }

    return {
      ok: true,
      replyId: reply.id,
      meetingId: meeting.id,
      bookingUrl,
      requiresHumanReview: !bookingUrl,
      workflowRunId,
      jobId: input.jobId,
    };
  }

  private classifyReplyIntent(input: { subjectLine?: string | null; bodyText?: string | null }) {
    const subject = (input.subjectLine || '').toLowerCase();
    const body = (input.bodyText || '').toLowerCase();
    const text = `${subject}
${body}`;
    const signals: string[] = [];

    const has = (phrases: string[]) => {
      const match = phrases.find((phrase) => text.includes(phrase));
      if (match) signals.push(match);
      return Boolean(match);
    };

    if (has(['unsubscribe', 'remove me', 'stop emailing', 'do not contact', "don't contact"])) {
      return { intent: ReplyIntent.UNSUBSCRIBE, confidence: 0.99, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['out of office', 'ooo', 'automatic reply', 'auto-reply'])) {
      return { intent: ReplyIntent.OOO, confidence: 0.94, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['not relevant', 'not a fit', 'no interest', 'not interested', 'not for us'])) {
      return { intent: ReplyIntent.NOT_RELEVANT, confidence: 0.93, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['circle back', 'next quarter', 'next month', 'later this year', 'not right now', 'not now'])) {
      return { intent: ReplyIntent.NOT_NOW, confidence: 0.9, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['talk next week', 'book a call', 'schedule a call', "let's meet", 'lets meet', 'interested', 'sounds good', 'happy to chat', 'send me your calendar', 'book time'])) {
      return { intent: ReplyIntent.INTERESTED, confidence: 0.95, requiresHumanReview: false, matchedSignals: signals };
    }
    if (has(['reach out to', 'contact', 'speak with', 'forwarding you to', 'cc ', 'looping in'])) {
      return { intent: ReplyIntent.REFERRAL, confidence: 0.82, requiresHumanReview: false, matchedSignals: signals };
    }
    if (!body.trim()) {
      return { intent: ReplyIntent.HUMAN_REVIEW, confidence: 0.4, requiresHumanReview: true, matchedSignals: signals };
    }
    return { intent: ReplyIntent.UNCLEAR, confidence: 0.55, requiresHumanReview: true, matchedSignals: signals };
  }

  private buildMeetingNotes(reply: any) {
    const lines = [
      `Reply from: ${reply.fromEmail || 'unknown'}`,
      `Intent: ${reply.intent}`,
      reply.subjectLine ? `Subject: ${reply.subjectLine}` : null,
      reply.bodyText ? `Body: ${reply.bodyText}` : null,
    ].filter(Boolean);

    return lines.join('\n\n');
  }

  private buildMessageSubject(lead: any, jobType: JobType) {
    const company = lead.account?.companyName || lead.client.displayName;
    if (jobType === JobType.FOLLOWUP_SEND) {
      return `Following up about ${company}`;
    }
    return `Quick intro for ${company}`;
  }

  private buildMessageBody(lead: any, jobType: JobType, note?: string) {
    const firstName = lead.contact?.firstName || lead.contact?.fullName || 'there';
    const offer = lead.campaign.offerSummary || lead.client.outboundOffer || 'a relevant business offer';
    const bookingUrl = lead.campaign.bookingUrlOverride || lead.client.bookingUrl;
    const intro =
      jobType === JobType.FOLLOWUP_SEND
        ? `Hi ${firstName},\n\nFollowing up on my earlier note.`
        : `Hi ${firstName},\n\nReaching out with a quick intro.`;

    return [
      intro,
      `\n\nWe are helping teams around: ${offer}.`,
      bookingUrl ? `\n\nIf helpful, here is the booking link: ${bookingUrl}` : '',
      note ? `\n\nNote: ${note}` : '',
      `\n\nBest,\nOrchestrate`,
    ].join('');
  }

  private resolveWorkflowType(jobType: JobType): WorkflowType {
    if (jobType === JobType.FOLLOWUP_SEND) return WorkflowType.FOLLOW_UP_EXECUTION;
    if (jobType === JobType.LEAD_IMPORT) return WorkflowType.CAMPAIGN_GENERATION;
    if (jobType === JobType.REPLY_CLASSIFICATION) return WorkflowType.REPLY_PROCESSING;
    if (jobType === JobType.MEETING_HANDOFF) return WorkflowType.MEETING_CONVERSION;
    return WorkflowType.OUTREACH_EXECUTION;
  }

  private async resolveClientId(leadId: string): Promise<string> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { clientId: true },
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    return lead.clientId;
  }

  private asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, any>) }
      : {};
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }

  private readSeedProspects(value: unknown): Array<{
    companyName?: string;
    domain?: string;
    industry?: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    title?: string;
    email: string;
    phone?: string;
    websiteUrl?: string;
    linkedinUrl?: string;
    city?: string;
    region?: string;
    countryCode?: string;
    timezone?: string;
    priority?: number;
    score?: number;
    origin?: string;
  }> {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => this.asObject(item))
      .map((item) => {
        const email = this.readString(item.email)?.toLowerCase();
        const fullName = this.readString(item.fullName) ?? [this.readString(item.firstName), this.readString(item.lastName)].filter(Boolean).join(' ');
        if (!email || !fullName) return null;
        return {
          companyName: this.readString(item.companyName) ?? undefined,
          domain: this.readString(item.domain) ?? undefined,
          industry: this.readString(item.industry) ?? undefined,
          fullName,
          firstName: this.readString(item.firstName) ?? undefined,
          lastName: this.readString(item.lastName) ?? undefined,
          title: this.readString(item.title) ?? undefined,
          email,
          phone: this.readString(item.phone) ?? undefined,
          websiteUrl: this.readString(item.websiteUrl) ?? undefined,
          linkedinUrl: this.readString(item.linkedinUrl) ?? undefined,
          city: this.readString(item.city) ?? undefined,
          region: this.readString(item.region) ?? undefined,
          countryCode: this.readString(item.countryCode)?.toUpperCase() ?? undefined,
          timezone: this.readString(item.timezone) ?? undefined,
          priority: typeof item.priority === 'number' ? item.priority : undefined,
          score: typeof item.score === 'number' ? item.score : undefined,
          origin: this.readString(item.origin) ?? undefined,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
}
