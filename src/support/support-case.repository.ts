import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { IntakeAiResult, NormalizedIntakeInput } from '../intake/intake.types';
import { randomUUID } from 'crypto';

@Injectable()
export class SupportCaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createFollowUpSession(params: {
    input: NormalizedIntakeInput;
    ai: IntakeAiResult;
    reply: string;
    questions: string[];
  }): Promise<{ inquiryId: string; sessionId: string }> {
    const sessionId = this.buildSessionId();
    const now = new Date();
    const reply = params.reply ?? params.ai.suggestedReply ?? '';

    const inquiry = await this.prisma.publicInquiry.create({
      data: {
        inquiryType: this.resolveInquiryType(params.input.inquiryTypeHint),
        status: 'IN_PROGRESS' as any,
        source: this.resolveSource(params.input.source),
        name: this.resolveName(params.input),
        email: this.resolveEmail(params.input),
        company: params.input.company ?? null,
        message: params.input.message,
        metadataJson: {
          intake: {
            mode: 'follow_up',
            persistedAt: now.toISOString(),
          },
        } as any,
        sourceKind: params.input.source,
        accountType: this.resolveAccountType(params.input.source),
        category: params.ai.category.toUpperCase() as any,
        intent: params.ai.intent.toUpperCase() as any,
        priority: params.ai.priority.toUpperCase() as any,
        aiConfidence: params.ai.confidence,
        requiresHuman: params.ai.requiresHuman,
        shouldAskFollowUp: true,
        resolvedByAi: false,
        aiSummary: params.ai.summary,
        aiSuggestedReply: reply,
        aiRawJson: params.ai as any,
        followUpStateJson: this.buildFollowUpState(
          [
            {
              role: 'user',
              message: params.input.message,
              at: now.toISOString(),
            },
            {
              role: 'assistant',
              message: reply,
              questions: params.questions,
              at: now.toISOString(),
            },
          ],
          {
            awaitingReply: true,
            missingFields: params.ai.missingFields ?? [],
            questions: params.questions,
          },
        ),
        sourcePage: params.input.sourcePage ?? null,
        planContext: params.input.planContext ?? null,
        tierContext: params.input.tierContext ?? null,
        intakeSessionId: sessionId,
        userId: params.input.userId ?? null,
        clientId: params.input.clientId ?? null,
        firstResponseDueAt: now,
        nextResponseDueAt: now,
        lastInboundAt: now,
        lastOutboundAt: now,
        lastActivityAt: now,
        messages: {
          create: [
            this.buildInboundMessage(params.input, now),
            this.buildOutboundAiMessage(reply, params.input, now),
          ],
        },
      },
      select: { id: true, intakeSessionId: true },
    });

    return {
      inquiryId: inquiry.id,
      sessionId: inquiry.intakeSessionId || sessionId,
    };
  }

  async createEscalatedCase(params: {
    input: NormalizedIntakeInput;
    ai: IntakeAiResult;
    reply: string;
  }): Promise<{ inquiryId: string; sessionId: string }> {
    const sessionId = this.buildSessionId();
    const now = new Date();
    const reply = params.reply ?? params.ai.suggestedReply ?? '';

    const inquiry = await this.prisma.publicInquiry.create({
      data: {
        inquiryType: this.resolveInquiryType(params.input.inquiryTypeHint),
        status: 'NEW' as any,
        source: this.resolveSource(params.input.source),
        name: this.resolveName(params.input),
        email: this.resolveEmail(params.input),
        company: params.input.company ?? null,
        message: params.input.message,
        metadataJson: {
          intake: {
            mode: 'escalated',
            persistedAt: now.toISOString(),
          },
        } as any,
        sourceKind: params.input.source,
        accountType: this.resolveAccountType(params.input.source),
        category: params.ai.category.toUpperCase() as any,
        intent: params.ai.intent.toUpperCase() as any,
        priority: params.ai.priority.toUpperCase() as any,
        aiConfidence: params.ai.confidence,
        requiresHuman: true,
        shouldAskFollowUp: false,
        resolvedByAi: false,
        aiSummary: params.ai.summary,
        aiSuggestedReply: reply,
        aiRawJson: params.ai as any,
        sourcePage: params.input.sourcePage ?? null,
        planContext: params.input.planContext ?? null,
        tierContext: params.input.tierContext ?? null,
        intakeSessionId: sessionId,
        userId: params.input.userId ?? null,
        clientId: params.input.clientId ?? null,
        isEscalated: true,
        escalatedAt: now,
        firstResponseDueAt: now,
        nextResponseDueAt: now,
        lastInboundAt: now,
        lastOutboundAt: now,
        lastActivityAt: now,
        messages: {
          create: [
            this.buildInboundMessage(params.input, now),
            this.buildOutboundAiMessage(reply, params.input, now),
          ],
        },
      },
      select: { id: true, intakeSessionId: true },
    });

    return {
      inquiryId: inquiry.id,
      sessionId: inquiry.intakeSessionId || sessionId,
    };
  }

  async getBySessionId(sessionId: string) {
    const inquiry = await this.prisma.publicInquiry.findFirst({
      where: { intakeSessionId: sessionId },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        message: true,
        sourceKind: true,
        sourcePage: true,
        planContext: true,
        tierContext: true,
        userId: true,
        clientId: true,
        category: true,
        followUpStateJson: true,
      },
    });

    if (!inquiry) {
      throw new NotFoundException('Support session not found');
    }

    return inquiry;
  }

  async appendInboundReply(params: {
    inquiryId: string;
    message: string;
    email?: string | null;
    source: 'PUBLIC' | 'CLIENT';
    history?: unknown[];
  }): Promise<void> {
    const now = new Date();
    const nextHistory = this.appendHistory(params.history, {
      role: 'user',
      message: params.message,
      at: now.toISOString(),
    });

    await this.prisma.publicInquiry.update({
      where: { id: params.inquiryId },
      data: {
        lastInboundAt: now,
        lastActivityAt: now,
        followUpStateJson: this.buildFollowUpState(nextHistory),
        messages: {
          create: {
            direction: 'INBOUND' as any,
            channel: this.resolveChannel(params.source),
            messageType: 'CUSTOMER' as any,
            authorType: 'USER' as any,
            visibility: 'PUBLIC_THREAD' as any,
            bodyText: params.message,
            fromEmail: params.email ?? null,
            receivedAt: now,
          },
        },
      },
    });
  }

  async markNeedsFollowUp(params: {
    inquiryId: string;
    ai: IntakeAiResult;
    reply: string;
    questions: string[];
    history?: unknown[];
    source: 'PUBLIC' | 'CLIENT';
    email?: string | null;
  }): Promise<void> {
    const now = new Date();
    const reply = params.reply ?? params.ai.suggestedReply ?? '';
    const nextHistory = this.appendHistory(params.history, {
      role: 'assistant',
      message: reply,
      questions: params.questions,
      at: now.toISOString(),
    });

    await this.prisma.publicInquiry.update({
      where: { id: params.inquiryId },
      data: {
        status: 'IN_PROGRESS' as any,
        category: params.ai.category.toUpperCase() as any,
        intent: params.ai.intent.toUpperCase() as any,
        priority: params.ai.priority.toUpperCase() as any,
        aiConfidence: params.ai.confidence,
        requiresHuman: params.ai.requiresHuman,
        shouldAskFollowUp: true,
        resolvedByAi: false,
        aiSummary: params.ai.summary,
        aiSuggestedReply: reply,
        aiRawJson: params.ai as any,
        nextResponseDueAt: now,
        lastOutboundAt: now,
        lastActivityAt: now,
        followUpStateJson: this.buildFollowUpState(nextHistory, {
          awaitingReply: true,
          missingFields: params.ai.missingFields ?? [],
          questions: params.questions,
        }),
        messages: {
          create: this.buildOutboundAiMessage(
            reply,
            { source: params.source } as NormalizedIntakeInput,
            now,
            params.email ?? null,
          ),
        },
      },
    });
  }

  async markResolvedByAi(params: {
    inquiryId: string;
    ai: IntakeAiResult;
    reply: string;
    history?: unknown[];
    source: 'PUBLIC' | 'CLIENT';
    email?: string | null;
  }): Promise<void> {
    const now = new Date();
    const reply = params.reply ?? params.ai.suggestedReply ?? '';
    const nextHistory = this.appendHistory(params.history, {
      role: 'assistant',
      message: reply,
      at: now.toISOString(),
    });

    await this.prisma.publicInquiry.update({
      where: { id: params.inquiryId },
      data: {
        status: 'CLOSED' as any,
        category: params.ai.category.toUpperCase() as any,
        intent: params.ai.intent.toUpperCase() as any,
        priority: params.ai.priority.toUpperCase() as any,
        aiConfidence: params.ai.confidence,
        requiresHuman: false,
        shouldAskFollowUp: false,
        resolvedByAi: true,
        aiSummary: params.ai.summary,
        aiSuggestedReply: reply,
        aiRawJson: params.ai as any,
        firstRespondedAt: now,
        lastOutboundAt: now,
        lastActivityAt: now,
        closedAt: now,
        followUpStateJson: this.buildFollowUpState(nextHistory, {
          awaitingReply: false,
        }),
        messages: {
          create: this.buildOutboundAiMessage(
            reply,
            { source: params.source } as NormalizedIntakeInput,
            now,
            params.email ?? null,
          ),
        },
      },
    });
  }

  async escalateExistingSession(params: {
    inquiryId: string;
    ai: IntakeAiResult;
    reply: string;
    history?: unknown[];
    source: 'PUBLIC' | 'CLIENT';
    email?: string | null;
  }): Promise<void> {
    const now = new Date();
    const reply = params.reply ?? params.ai.suggestedReply ?? '';
    const nextHistory = this.appendHistory(params.history, {
      role: 'assistant',
      message: reply,
      at: now.toISOString(),
    });

    await this.prisma.publicInquiry.update({
      where: { id: params.inquiryId },
      data: {
        status: 'NEW' as any,
        category: params.ai.category.toUpperCase() as any,
        intent: params.ai.intent.toUpperCase() as any,
        priority: params.ai.priority.toUpperCase() as any,
        aiConfidence: params.ai.confidence,
        requiresHuman: true,
        shouldAskFollowUp: false,
        resolvedByAi: false,
        aiSummary: params.ai.summary,
        aiSuggestedReply: reply,
        aiRawJson: params.ai as any,
        isEscalated: true,
        escalatedAt: now,
        nextResponseDueAt: now,
        lastOutboundAt: now,
        lastActivityAt: now,
        followUpStateJson: this.buildFollowUpState(nextHistory, {
          awaitingReply: false,
        }),
        messages: {
          create: this.buildOutboundAiMessage(
            reply,
            { source: params.source } as NormalizedIntakeInput,
            now,
            params.email ?? null,
          ),
        },
      },
    });
  }

  private buildSessionId(): string {
    return `sess_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }

  private resolveSource(source: 'PUBLIC' | 'CLIENT'): string {
    return source === 'CLIENT' ? 'client_support_intake' : 'public_intake';
  }

  private resolveAccountType(source: 'PUBLIC' | 'CLIENT'): 'PUBLIC' | 'CLIENT' {
    return source;
  }

  private resolveInquiryType(hint?: string | null) {
    switch ((hint ?? '').trim().toLowerCase()) {
      case 'pricing':
        return 'PRICING' as any;
      case 'billing_support':
      case 'billing':
        return 'BILLING_SUPPORT' as any;
      case 'onboarding':
        return 'ONBOARDING' as any;
      case 'partnership':
        return 'PARTNERSHIP' as any;
      case 'service_fit':
        return 'SERVICE_FIT' as any;
      default:
        return 'GENERAL_INQUIRY' as any;
    }
  }

  private resolveName(input: NormalizedIntakeInput): string {
    if (input.name?.trim()) return input.name.trim();
    if (input.source === 'CLIENT') return 'Client';
    return 'Unknown';
  }

  private resolveEmail(input: NormalizedIntakeInput): string {
    if (input.email?.trim()) return input.email.trim().toLowerCase();
    if (input.source === 'CLIENT' && input.userId) return `${input.userId}@client.local`;
    return 'unknown@local.invalid';
  }

  private resolveChannel(source: 'PUBLIC' | 'CLIENT') {
    return source === 'CLIENT' ? ('INTERNAL' as any) : ('EMAIL' as any);
  }

  private buildInboundMessage(input: NormalizedIntakeInput, now: Date) {
    return {
      direction: 'INBOUND' as any,
      channel: this.resolveChannel(input.source),
      messageType: 'CUSTOMER' as any,
      authorType: 'USER' as any,
      visibility: 'PUBLIC_THREAD' as any,
      bodyText: input.message,
      fromEmail: input.email ?? null,
      receivedAt: now,
    };
  }

  private buildOutboundAiMessage(
    reply: string,
    input: NormalizedIntakeInput,
    now: Date,
    toEmail?: string | null,
  ) {
    return {
      direction: 'OUTBOUND' as any,
      channel: this.resolveChannel(input.source),
      messageType: 'AUTO_ACK' as any,
      authorType: 'AI' as any,
      visibility: 'PUBLIC_THREAD' as any,
      bodyText: reply,
      toEmail: toEmail ?? input.email ?? null,
      sentAt: now,
    };
  }

  private appendHistory(history: unknown[] | undefined, entry: Record<string, unknown>) {
    const safeHistory = Array.isArray(history) ? history : [];
    return [...safeHistory, entry];
  }

  private buildFollowUpState(
    history: unknown[],
    extra: Record<string, unknown> = {},
  ) {
    return {
      ...extra,
      history: JSON.parse(JSON.stringify(history)),
    } as any;
  }
}
