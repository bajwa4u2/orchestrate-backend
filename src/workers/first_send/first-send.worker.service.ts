import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityVisibility,
  Job,
  JobStatus,
  JobType,
  LeadQualificationState,
  LeadStatus,
  MessageLifecycle,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { DeliverabilityService } from '../../deliverability/deliverability.service';
import { EmailsService } from '../../emails/emails.service';
import { MessageGenerationWorkerService } from '../message_generation/message-generation.worker.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class FirstSendWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.FIRST_SEND];
  private static readonly DEFAULT_FOLLOWUP_WAIT_DAYS = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliverabilityService: DeliverabilityService,
    private readonly emailsService: EmailsService,
    private readonly messageGenerationWorker: MessageGenerationWorkerService,
  ) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const leadId = this.readString(context.payload.leadId);
    if (!leadId) {
      throw new BadRequestException(`Job ${job.id} is missing leadId`);
    }

    return this.sendLeadMessage({
      leadId,
      job,
      workflowRunId: context.workflowRunId,
      jobType: JobType.FIRST_SEND,
      simulateDeliveryOnly: Boolean(context.payload.simulateDeliveryOnly),
      note: this.readString(context.payload.note) ?? undefined,
    });
  }

  async sendLeadMessage(input: {
    leadId: string;
    job: Job;
    workflowRunId?: string;
    jobType: JobType;
    simulateDeliveryOnly?: boolean;
    note?: string;
  }) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: input.leadId },
      include: {
        account: true,
        contact: true,
        campaign: true,
        client: true,
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead ${input.leadId} not found`);
    }

    if (lead.campaign.status !== 'ACTIVE') {
      return {
        ok: true,
        skipped: true,
        reason: `campaign_${lead.campaign.status.toLowerCase()}`,
        leadId: lead.id,
      };
    }

    const email = lead.contact?.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException(`Lead ${lead.id} has no contact email`);
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

      return {
        ok: false,
        suppressed: true,
        leadId: lead.id,
        suppressionId: suppression.id,
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

    const generated = await this.messageGenerationWorker.prepareLeadMessage({
      leadId: lead.id,
      campaignId: lead.campaignId,
      clientId: lead.clientId,
      organizationId: lead.organizationId,
      jobType: input.jobType,
      note: input.note,
    });

    const lifecycle =
      input.simulateDeliveryOnly ? MessageLifecycle.SCHEDULED : MessageLifecycle.DISPATCHED;
    const status = input.simulateDeliveryOnly ? MessageStatus.SCHEDULED : MessageStatus.SENT;
    const sequenceStepOrder = generated.stepOrderIndex;
    const waitDays = FirstSendWorkerService.DEFAULT_FOLLOWUP_WAIT_DAYS;
    const threadKey = `${lead.id}:${sequenceStepOrder}:${Date.now()}`;

    const transport = input.simulateDeliveryOnly
      ? null
      : await this.emailsService.sendDirectEmail({
          toEmail: email,
          toName: lead.contact?.fullName ?? lead.contact?.firstName ?? undefined,
          subject: generated.subject,
          bodyText: generated.body,
          category: 'hello',
          replyToEmail: mailbox.emailAddress,
          templateVariables: {
            lead_id: lead.id,
            campaign_id: lead.campaignId,
            sequence_step: sequenceStepOrder,
          },
        });

    const message = await this.prisma.outreachMessage.create({
      data: {
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        campaignId: lead.campaignId,
        leadId: lead.id,
        mailboxId: mailbox.id,
        workflowRunId: input.workflowRunId,
        direction: 'OUTBOUND',
        channel: 'EMAIL',
        status,
        source: 'SYSTEM_GENERATED',
        lifecycle,
        subjectLine: generated.subject,
        bodyText: generated.body,
        sentAt: input.simulateDeliveryOnly ? null : new Date(),
        externalMessageId: transport?.externalMessageId ?? null,
        threadKey,
        metadataJson: {
          simulateDeliveryOnly: input.simulateDeliveryOnly ?? false,
          mailboxEmail: mailbox.emailAddress,
          jobType: input.jobType,
          workflowRunId: input.workflowRunId,
          sequenceId: generated.sequenceId,
          sequenceStepId: generated.sequenceStepId,
          sequenceStepOrder,
          waitDays,
          transportMode: transport?.mode ?? 'simulation',
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
        metadataJson: toPrismaJson({
          ...this.asObject(lead.metadataJson),
          sequenceState: {
            currentStep: sequenceStepOrder,
            lastMessageId: message.id,
            lastSentAt: new Date().toISOString(),
            sequenceId: generated.sequenceId,
          },
        }),
      },
    });

    await this.prisma.campaign.update({
      where: { id: lead.campaignId },
      data: {
        generationState: 'ACTIVE',
        status: 'ACTIVE',
      },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        campaignId: lead.campaignId,
        workflowRunId: input.workflowRunId,
        kind: 'MESSAGE_SENT',
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'outreach_message',
        subjectId: message.id,
        summary: `${input.jobType === JobType.FOLLOWUP_SEND ? 'Follow-up' : 'First send'} issued to ${email}`,
        metadataJson: {
          leadId: lead.id,
          messageId: message.id,
          mailboxId: mailbox.id,
          sequenceStepOrder,
          externalMessageId: transport?.externalMessageId ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    if (!input.simulateDeliveryOnly && input.jobType === JobType.FIRST_SEND) {
      const scheduledFor = new Date(Date.now() + waitDays * 24 * 60 * 60 * 1000);
      const dedupeKey = `${JobType.FOLLOWUP_SEND}:${lead.id}:${sequenceStepOrder + 1}:${scheduledFor.toISOString().slice(0, 10)}`;

      const existingFollowUp = await this.prisma.job.findFirst({
        where: {
          dedupeKey,
          status: {
            in: [
              JobStatus.QUEUED,
              JobStatus.RUNNING,
              JobStatus.RETRY_SCHEDULED,
              JobStatus.SUCCEEDED,
            ],
          },
        },
        select: { id: true },
      });

      if (!existingFollowUp) {
        await this.prisma.job.create({
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
              workflowRunId: input.workflowRunId,
              note: 'automatic follow-up after first send',
            }),
          },
        });
      }
    }

    return {
      ok: true,
      leadId: lead.id,
      messageId: message.id,
      mailboxId: mailbox.id,
      mailbox: mailbox.emailAddress,
      externalMessageId: transport?.externalMessageId ?? null,
      status: input.jobType === JobType.FOLLOWUP_SEND ? LeadStatus.FOLLOWED_UP : LeadStatus.CONTACTED,
      sequenceStepOrder,
      nextWaitDays: waitDays,
      simulateDeliveryOnly: input.simulateDeliveryOnly ?? false,
      jobId: input.job.id,
    };
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }
}