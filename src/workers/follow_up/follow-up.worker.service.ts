import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Job, JobStatus, JobType, LeadStatus } from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { FirstSendWorkerService } from '../first_send/first-send.worker.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class FollowUpWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.FOLLOWUP_SEND];

  constructor(
    private readonly prisma: PrismaService,
    private readonly firstSendWorker: FirstSendWorkerService,
  ) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const leadId = this.readString(context.payload.leadId);
    if (!leadId) {
      throw new BadRequestException(`Job ${job.id} is missing leadId`);
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { campaign: true },
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    if (lead.campaign.status !== 'ACTIVE') {
      return {
        ok: true,
        skipped: true,
        reason: `campaign_${lead.campaign.status.toLowerCase()}`,
        leadId,
      };
    }

    if (
      lead.status === LeadStatus.INTERESTED ||
      lead.status === LeadStatus.BOOKED ||
      lead.status === LeadStatus.SUPPRESSED
    ) {
      return {
        ok: true,
        skipped: true,
        reason: `lead_${lead.status.toLowerCase()}`,
        leadId,
      };
    }

    const existingReply = await this.prisma.reply.findFirst({
      where: {
        leadId,
        handledAt: { not: null },
      },
      select: { id: true },
    });

    if (existingReply) {
      return {
        ok: true,
        skipped: true,
        reason: 'reply_already_received',
        leadId,
        replyId: existingReply.id,
      };
    }

    const result = await this.firstSendWorker.sendLeadMessage({
      leadId,
      job,
      workflowRunId: context.workflowRunId,
      jobType: JobType.FOLLOWUP_SEND,
      simulateDeliveryOnly: Boolean(context.payload.simulateDeliveryOnly),
      note: this.readString(context.payload.note) ?? undefined,
    });

    const refreshedLead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { metadataJson: true, campaignId: true, clientId: true, organizationId: true },
    });

    const metadata = this.asObject(refreshedLead?.metadataJson);
    const sequenceState = this.asObject(metadata.sequenceState);
    const currentStep = Math.max(1, Number(sequenceState.currentStep ?? 1));

    const sequence = refreshedLead?.campaignId
      ? await this.prisma.sequence.findFirst({
          where: { campaignId: refreshedLead.campaignId },
          select: { id: true },
        })
      : null;

    const nextStep = sequence
      ? await this.prisma.sequenceStep.findFirst({
          where: { sequenceId: sequence.id, orderIndex: currentStep + 1 },
        })
      : null;

    if (nextStep && refreshedLead && !Boolean(context.payload.simulateDeliveryOnly)) {
      const waitDays = Math.max(0, Number(nextStep.waitDays ?? 0));
      const scheduledFor = new Date(Date.now() + waitDays * 24 * 60 * 60 * 1000);
      const dedupeKey = `${JobType.FOLLOWUP_SEND}:${leadId}:${nextStep.orderIndex}:${scheduledFor.toISOString().slice(0, 10)}`;

      const existing = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: {
            in: [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED, JobStatus.SUCCEEDED],
          },
        },
        select: { id: true },
      });

      if (!existing) {
        await this.prisma.job.create({
          data: {
            organizationId: refreshedLead.organizationId,
            clientId: refreshedLead.clientId,
            campaignId: refreshedLead.campaignId,
            type: JobType.FOLLOWUP_SEND,
            status: JobStatus.QUEUED,
            queueName: 'followup',
            dedupeKey,
            scheduledFor,
            maxAttempts: 3,
            payloadJson: toPrismaJson({
              leadId,
              workflowRunId: context.workflowRunId,
              note: 'sequence follow-up',
            }),
          },
        });
      }
    }

    return { ...result, nextSequenceStepExists: Boolean(nextStep) };
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }
}