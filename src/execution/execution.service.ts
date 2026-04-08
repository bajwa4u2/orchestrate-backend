import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityVisibility,
  JobStatus,
  JobType,
  LeadQualificationState,
  LeadStatus,
  Mailbox,
  MessageLifecycle,
  MessageStatus,
  Prisma,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { DeliverabilityService } from '../deliverability/deliverability.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { DispatchDueJobsDto } from './dto/dispatch-due-jobs.dto';
import { QueueLeadSendDto } from './dto/queue-lead-send.dto';
import { RunJobDto } from './dto/run-job.dto';

@Injectable()
export class ExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliverabilityService: DeliverabilityService,
    private readonly workflowsService: WorkflowsService,
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
    return jobType === JobType.FOLLOWUP_SEND ? WorkflowType.FOLLOW_UP_EXECUTION : WorkflowType.OUTREACH_EXECUTION;
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
}
