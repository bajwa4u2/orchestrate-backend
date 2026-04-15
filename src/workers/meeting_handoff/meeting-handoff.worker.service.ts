import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import {
  ActivityVisibility,
  Job,
  JobType,
  LeadQualificationState,
  LeadStatus,
  MeetingStatus,
  MessageLifecycle,
  MessageStatus,
  ReplyIntent,
} from '@prisma/client';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../../emails/emails.service';
import { JobWorker, WorkerContext, WorkerRunResult } from '../worker.types';

@Injectable()
export class MeetingHandoffWorkerService implements JobWorker {
  readonly jobTypes: JobType[] = [JobType.MEETING_HANDOFF];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EmailsService))
    private readonly emailsService: EmailsService,
  ) {}

  async run(job: Job, context: WorkerContext): Promise<WorkerRunResult> {
    const replyId = this.readString(context.payload.replyId);
    if (!replyId) {
      throw new BadRequestException(`Job ${job.id} is missing replyId`);
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

    const bookingUrl = reply.campaign?.bookingUrlOverride || reply.lead?.client?.bookingUrl || null;
    const title = `Meeting request · ${reply.lead?.account?.companyName || reply.fromEmail || 'Prospect'}`;

    const meeting = reply.meeting
      ? await this.prisma.meeting.update({
          where: { id: reply.meeting.id },
          data: {
            workflowRunId: context.workflowRunId,
            status: MeetingStatus.PROPOSED,
            bookingUrl,
            title,
            notesText: this.buildMeetingNotes(reply),
            metadataJson: toPrismaJson({
              ...this.asObject(reply.meeting.metadataJson),
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
            workflowRunId: context.workflowRunId,
            status: MeetingStatus.PROPOSED,
            source: 'SYSTEM_GENERATED',
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

    const subjectLine = this.buildMeetingResponseSubject(reply);
    const bodyText = this.buildMeetingResponseBody(reply, bookingUrl);

    const recipientEmail = this.readString(reply.fromEmail);
    let meetingResponseId: string | null = null;
    let externalMessageId: string | null = null;
    let transportMode: string | null = null;
    const requiresHumanReview = !bookingUrl || !recipientEmail;

    if (recipientEmail) {
      const transport = await this.emailsService.sendDirectEmail({
        toEmail: recipientEmail,
        toName: reply.lead?.contact?.fullName ?? reply.lead?.contact?.firstName ?? undefined,
        subject: subjectLine,
        bodyText,
        category: 'hello',
        replyToEmail: reply.lead?.client?.primaryEmail ?? undefined,
        templateVariables: {
          meeting_id: meeting.id,
          booking_url: bookingUrl,
        },
      });

      externalMessageId = transport.externalMessageId ?? null;
      transportMode = transport.mode;

      const meetingResponse = await this.prisma.outreachMessage.create({
        data: {
          organizationId: reply.organizationId,
          clientId: reply.clientId,
          campaignId: reply.campaignId,
          leadId: reply.leadId,
          mailboxId: reply.mailboxId,
          workflowRunId: context.workflowRunId,
          direction: 'OUTBOUND',
          channel: 'EMAIL',
          status: MessageStatus.SENT,
          source: 'SYSTEM_GENERATED',
          lifecycle: MessageLifecycle.DISPATCHED,
          subjectLine,
          bodyText,
          sentAt: new Date(),
          externalMessageId,
          threadKey: reply.messageId ?? reply.id,
          metadataJson: toPrismaJson({
            type: 'meeting_response',
            replyId: reply.id,
            meetingId: meeting.id,
            bookingUrl,
            transportMode,
          }),
        },
      });

      meetingResponseId = meetingResponse.id;
    }

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
        requiresHumanReview,
        workflowRunId: context.workflowRunId,
      },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: reply.organizationId,
        clientId: reply.clientId,
        campaignId: reply.campaignId,
        workflowRunId: context.workflowRunId,
        kind: 'MEETING_BOOKED',
        visibility: ActivityVisibility.CLIENT_VISIBLE,
        subjectType: 'meeting',
        subjectId: meeting.id,
        summary: recipientEmail
          ? bookingUrl
            ? 'Meeting handoff prepared with booking link.'
            : 'Interested reply converted into a meeting handoff requiring review.'
          : 'Interested reply converted into a meeting handoff but response email could not be sent.',
        metadataJson: toPrismaJson({
          meetingId: meeting.id,
          replyId: reply.id,
          bookingUrl,
          responseMessageId: meetingResponseId,
          recipientEmail,
        }),
      },
    });

    return {
      ok: true,
      replyId: reply.id,
      meetingId: meeting.id,
      bookingUrl,
      responseMessageId: meetingResponseId,
      externalMessageId,
      requiresHumanReview,
      workflowRunId: context.workflowRunId,
      jobId: job.id,
    };
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

  private buildMeetingResponseSubject(reply: any) {
    return reply.subjectLine ? `Re: ${reply.subjectLine}` : 'Re: Quick follow-up';
  }

  private buildMeetingResponseBody(reply: any, bookingUrl: string | null) {
    const firstName =
      reply.lead?.contact?.firstName ||
      reply.lead?.contact?.fullName ||
      reply.lead?.account?.companyName ||
      'there';

    if (bookingUrl) {
      return [
        `Hi ${firstName},`,
        '',
        'Thanks for your response.',
        '',
        `You can pick a time that works for you here: ${bookingUrl}`,
        '',
        'Best,',
        'Orchestrate',
      ].join('\n');
    }

    return [
      `Hi ${firstName},`,
      '',
      'Thanks for your response.',
      '',
      'I’ll coordinate a time and get back to you shortly.',
      '',
      'Best,',
      'Orchestrate',
    ].join('\n');
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