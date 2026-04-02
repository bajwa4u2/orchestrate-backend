import { Injectable } from '@nestjs/common';
import { LeadStatus, MeetingStatus, Prisma, ReplyIntent } from '@prisma/client';
import { buildPagination } from '../common/utils/pagination';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { IntakeReplyDto } from './dto/intake-reply.dto';
import { ListRepliesDto } from './dto/list-replies.dto';

@Injectable()
export class RepliesService {
  constructor(private readonly prisma: PrismaService) {}

  async intake(dto: IntakeReplyDto) {
    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: dto.leadId },
      include: { client: true, campaign: true },
    });

    const intent = dto.intent ?? this.classifyReplyIntent(dto.bodyText || dto.subjectLine || '');
    const requiresHumanReview =
      intent === ReplyIntent.UNCLEAR ||
      intent === ReplyIntent.HUMAN_REVIEW ||
      intent === ReplyIntent.REFERRAL;

    const reply = await this.prisma.reply.create({
      data: {
        organizationId: dto.organizationId,
        clientId: dto.clientId,
        campaignId: dto.campaignId || lead.campaignId,
        leadId: dto.leadId,
        messageId: dto.messageId,
        mailboxId: dto.mailboxId,
        intent,
        confidence: 0.76,
        fromEmail: dto.fromEmail?.toLowerCase(),
        subjectLine: dto.subjectLine,
        bodyText: dto.bodyText,
        receivedAt: dto.receivedAt || new Date(),
        requiresHumanReview,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
    });

    if (dto.messageId) {
      await this.prisma.outreachMessage.update({
        where: { id: dto.messageId },
        data: { status: 'REPLIED' },
      }).catch(() => null);
    }

    const statusMap: Record<ReplyIntent, LeadStatus> = {
      INTERESTED: LeadStatus.INTERESTED,
      NOT_NOW: LeadStatus.REPLIED,
      NOT_RELEVANT: LeadStatus.CLOSED_LOST,
      REFERRAL: LeadStatus.REPLIED,
      UNSUBSCRIBE: LeadStatus.SUPPRESSED,
      OOO: LeadStatus.REPLIED,
      BOUNCE: LeadStatus.SUPPRESSED,
      UNCLEAR: LeadStatus.REPLIED,
      HUMAN_REVIEW: LeadStatus.REPLIED,
    };

    await this.prisma.lead.update({
      where: { id: dto.leadId },
      data: {
        status: statusMap[intent],
        lastReplyAt: dto.receivedAt || new Date(),
        suppressionReason: intent === ReplyIntent.UNSUBSCRIBE || intent === ReplyIntent.BOUNCE ? intent : undefined,
      },
    });

    let meeting: { id: string } | null = null;
    if (intent === ReplyIntent.INTERESTED) {
      meeting = await this.prisma.meeting.create({
        data: {
          organizationId: dto.organizationId,
          clientId: dto.clientId,
          campaignId: dto.campaignId || lead.campaignId,
          leadId: dto.leadId,
          replyId: reply.id,
          status: dto.booked ? MeetingStatus.BOOKED : MeetingStatus.PROPOSED,
          title: `Meeting handoff for ${lead.client.displayName}`,
          bookingUrl: lead.campaign.bookingUrlOverride || lead.client.bookingUrl,
          scheduledAt: dto.scheduledAt,
        },
      });

      if (dto.booked) {
        await this.prisma.lead.update({
          where: { id: dto.leadId },
          data: { status: LeadStatus.BOOKED, bookedAt: dto.scheduledAt || new Date() },
        });
      }
    }

    await this.prisma.activityEvent.create({
      data: {
        organizationId: dto.organizationId,
        clientId: dto.clientId,
        campaignId: dto.campaignId || lead.campaignId,
        kind: intent === ReplyIntent.INTERESTED && dto.booked ? 'MEETING_BOOKED' : 'REPLY_RECEIVED',
        subjectType: meeting ? 'meeting' : 'reply',
        subjectId: meeting?.id ?? reply.id,
        summary: `Reply received with intent ${intent}`,
        metadataJson: { leadId: dto.leadId, replyId: reply.id, meetingId: meeting?.id ?? null } as Prisma.InputJsonValue,
      },
    });

    if (requiresHumanReview) {
      await this.prisma.alert.create({
        data: {
          organizationId: dto.organizationId,
          clientId: dto.clientId,
          campaignId: dto.campaignId || lead.campaignId,
          severity: 'WARNING',
          status: 'OPEN',
          category: 'reply_review',
          title: `Reply requires review for lead ${dto.leadId}`,
          bodyText: `Intent ${intent} was detected and requires operator review.`,
          metadataJson: { replyId: reply.id } as Prisma.InputJsonValue,
        },
      });
    }

    return {
      ok: true,
      reply,
      meeting,
      leadStatus: dto.booked ? LeadStatus.BOOKED : statusMap[intent],
      requiresHumanReview,
    };
  }

  async list(query: ListRepliesDto) {
    const { page, limit, skip, take } = buildPagination(query.page, query.limit);
    const where = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.intent ? { intent: query.intent } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.reply.findMany({
        where,
        include: { lead: true, message: true, meeting: true },
        orderBy: { receivedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.reply.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  private classifyReplyIntent(text: string): ReplyIntent {
    const value = text.toLowerCase();
    if (/(book|calendar|available|schedule|meet)/.test(value)) return ReplyIntent.INTERESTED;
    if (/(unsubscribe|remove me|stop emailing)/.test(value)) return ReplyIntent.UNSUBSCRIBE;
    if (/(not now|later|next quarter|next month)/.test(value)) return ReplyIntent.NOT_NOW;
    if (/(not relevant|not interested|no thanks)/.test(value)) return ReplyIntent.NOT_RELEVANT;
    if (/(out of office|ooo|vacation)/.test(value)) return ReplyIntent.OOO;
    if (/(reach out to|contact|speak with)/.test(value)) return ReplyIntent.REFERRAL;
    if (/(bounce|undeliverable|invalid)/.test(value)) return ReplyIntent.BOUNCE;
    if (value.trim().length < 8) return ReplyIntent.HUMAN_REVIEW;
    return ReplyIntent.UNCLEAR;
  }
}
