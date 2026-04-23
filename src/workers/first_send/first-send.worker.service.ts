import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityVisibility,
  CommunicationType,
  Job,
  MessageClass,
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
        contact: {
          include: {
            contactChannels: {
              where: { type: 'EMAIL' },
              orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
              take: 1,
            },
          },
        },
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

    const primaryEmailChannel = this.resolvePrimaryEmailChannel(lead.contact);
    const email = primaryEmailChannel?.value?.trim().toLowerCase() ?? lead.contact?.email?.trim().toLowerCase() ?? null;
    if (!email) {
      throw new BadRequestException(`Lead ${lead.id} has no contact email`);
    }

    const healedChannel =
      lead.contactId && !primaryEmailChannel
        ? await this.deliverabilityService.ensurePrimaryEmailChannel({
            organizationId: lead.organizationId,
            clientId: lead.clientId,
            contactId: lead.contactId,
            emailAddress: email,
            isVerified: false,
            verificationSource: 'first_send_legacy_heal',
            metadataJson: {
              leadId: lead.id,
              campaignId: lead.campaignId,
            },
          })
        : primaryEmailChannel;

    const communicationGuard = await this.deliverabilityService.assertCommunicationAllowed({
      organizationId: lead.organizationId,
      clientId: lead.clientId,
      contactId: lead.contactId ?? undefined,
      contactChannelId: healedChannel?.id ?? undefined,
      emailAddress: email,
      communication: CommunicationType.OUTREACH,
    });

    if (!communicationGuard.allowed) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.SUPPRESSED,
          qualificationState: LeadQualificationState.DISQUALIFIED,
          suppressionReason: communicationGuard.reason,
        },
      });

      return {
        ok: false,
        suppressed: true,
        leadId: lead.id,
        suppressionId: communicationGuard.suppression?.id,
        reason: communicationGuard.reason,
      };
    }

    let mailbox = await this.deliverabilityService.pickMailboxForClient({
      organizationId: lead.organizationId,
      clientId: lead.clientId,
    });

    if (!mailbox) {
      const ensured = await this.deliverabilityService.ensureDefaultMailboxInfrastructure({
        organizationId: lead.organizationId,
        clientId: lead.clientId,
        timezone: lead.campaign.timezone ?? lead.client.primaryTimezone ?? undefined,
      });
      mailbox = ensured.mailbox;
    }

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

    const tightened = this.tightenGeneratedMessage({
      subject: generated.subject,
      body: generated.body,
      lead,
      mailbox,
      isFollowUp: input.jobType === JobType.FOLLOWUP_SEND,
    });

    const lifecycle =
      input.simulateDeliveryOnly ? MessageLifecycle.SCHEDULED : MessageLifecycle.DISPATCHED;
    const status = input.simulateDeliveryOnly ? MessageStatus.SCHEDULED : MessageStatus.SENT;
    const sequenceStepOrder = generated.stepOrderIndex;
    const waitDays = FirstSendWorkerService.DEFAULT_FOLLOWUP_WAIT_DAYS;
    const existingMetadata = this.asObject(lead.metadataJson);
    const existingSequenceState = this.asObject(existingMetadata.sequenceState);
    const rootThreadKey =
      this.readString(existingSequenceState.rootThreadKey) ??
      this.readString(existingSequenceState.threadKey) ??
      `${lead.id}:${generated.sequenceId ?? 'default'}`;
    const parentExternalMessageId = this.readString(existingSequenceState.lastExternalMessageId) ?? undefined;

    const contactChannelId = communicationGuard.channel?.id ?? null;

    const transport = input.simulateDeliveryOnly
      ? null
      : await this.emailsService.sendDirectEmail({
          toEmail: email,
          toName: lead.contact?.fullName ?? lead.contact?.firstName ?? undefined,
          subject: tightened.subject,
          bodyText: tightened.body,
          replyToEmail: this.resolveClientReplyToEmail(lead),
          templateVariables: {
            lead_id: lead.id,
            campaign_id: lead.campaignId,
            sequence_step: sequenceStepOrder,
            outreach_intent: input.jobType,
            client_display_name: this.resolveClientDisplayName(lead),
            client_website: lead.client?.websiteUrl ?? null,
            mailbox_email: mailbox.emailAddress,
            client_reply_to_email: this.resolveClientReplyToEmail(lead),
            representation_mode: 'orchestrate_on_behalf_of_client',
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
        messageClass: MessageClass.OUTREACH,
        contactChannelId,
        status,
        source: 'SYSTEM_GENERATED',
        lifecycle,
        subjectLine: tightened.subject,
        bodyText: tightened.body,
        sentAt: input.simulateDeliveryOnly ? null : new Date(),
        externalMessageId: transport?.externalMessageId ?? null,
        threadKey: rootThreadKey,
        metadataJson: {
          simulateDeliveryOnly: input.simulateDeliveryOnly ?? false,
          mailboxEmail: mailbox.emailAddress,
          clientReplyToEmail: this.resolveClientReplyToEmail(lead),
          representationMode: 'orchestrate_on_behalf_of_client',
          jobType: input.jobType,
          workflowRunId: input.workflowRunId,
          contactChannelId,
          sequenceId: generated.sequenceId,
          sequenceStepId: generated.sequenceStepId,
          sequenceStepOrder,
          waitDays,
          transportMode: transport?.mode ?? 'simulation',
          providerThreadId: parentExternalMessageId ?? transport?.externalMessageId ?? null,
          parentExternalMessageId: parentExternalMessageId ?? null,
          threadRootKey: rootThreadKey,
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
            contactChannelId,
            rootThreadKey,
            threadKey: rootThreadKey,
            lastExternalMessageId: transport?.externalMessageId ?? null,
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


  private resolvePrimaryEmailChannel(contact: any) {
    if (!contact) return null;
    const channels = Array.isArray(contact.contactChannels) ? contact.contactChannels : [];
    const explicit = channels.find((channel) => channel && channel.type === 'EMAIL' && channel.status === 'ACTIVE');
    if (explicit) return explicit;
    return channels[0] ?? null;
  }

  private tightenGeneratedMessage(input: {
    subject: string;
    body: string;
    lead: {
      client: {
        displayName: string | null;
        legalName: string | null;
        websiteUrl: string | null;
      } | null;
      contact: {
        fullName: string | null;
        firstName: string | null;
      } | null;
      account: {
        companyName: string | null;
      } | null;
    };
    mailbox: {
      emailAddress: string;
      fromName: string | null;
    };
    isFollowUp: boolean;
  }) {
    const clientName = this.resolveClientDisplayName(input.lead);
    const senderName =
      this.readString(input.mailbox.fromName) ??
      clientName ??
      'OrchestrateOps';
    const senderTitle = 'Revenue Operations';
    const senderEmail = input.mailbox.emailAddress;
    const prospectCompany = this.readString(input.lead.account?.companyName);
    const prospectName =
      this.readString(input.lead.contact?.firstName) ??
      this.readString(input.lead.contact?.fullName);

    let subject = this.normalizeInlineWhitespace(input.subject);
    let body = input.body.trim();

    if (!subject) {
      subject = input.isFollowUp
        ? `Following up${prospectCompany ? ` on ${prospectCompany}` : ''}`
        : `${clientName ?? 'OrchestrateOps'}${prospectCompany ? ` for ${prospectCompany}` : ''}`;
    }

    body = body
      .replace(/\[Your Name\]/gi, senderName)
      .replace(/\[Your Position\]/gi, senderTitle)
      .replace(/\[Your Contact Information\]/gi, senderEmail)
      .replace(/\[Your Company\]/gi, clientName ?? 'OrchestrateOps');

    if (prospectName) {
      body = body.replace(/\[First Name\]/gi, prospectName);
    }

    body = this.compactParagraphSpacing(body);

    return { subject, body };
  }

  private resolveClientDisplayName(lead: {
    client: {
      displayName: string | null;
      legalName: string | null;
      websiteUrl: string | null;
    } | null;
  }) {
    return (
      this.readString(lead.client?.displayName) ??
      this.readString(lead.client?.legalName) ??
      'OrchestrateOps'
    );
  }


private resolveClientReplyToEmail(lead: {
  clientId: string | null;
  client: {
    primaryEmail: string | null;
    email?: string | null;
    metadataJson?: unknown;
  } | null;
}) {
  const clientPrimaryEmail = this.readString(lead.client?.primaryEmail);
  const metadataEmail = this.readString(this.asObject(lead.client?.metadataJson).email);
  const fallbackEmail = this.readString(lead.client?.email);

  const resolved = clientPrimaryEmail ?? metadataEmail ?? fallbackEmail;

  if (!resolved) {
    throw new BadRequestException(
      `Client ${lead.clientId ?? 'unknown'} is missing primaryEmail for representative outreach reply handling`,
    );
  }

  return resolved.toLowerCase();
}


  private compactParagraphSpacing(value: string) {
    return value
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private normalizeInlineWhitespace(value: string) {
    return value.replace(/\s+/g, ' ').trim();
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
