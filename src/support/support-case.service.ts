import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { IntakeAiResult, NormalizedIntakeInput } from '../intake/intake.types';
import { structuredLog } from '../common/observability/structured-logger';
import { SupportCaseRepository } from './support-case.repository';

@Injectable()
export class SupportCaseService {
  constructor(private readonly repository: SupportCaseRepository) {}

  async createFollowUpSession(input: NormalizedIntakeInput, ai: IntakeAiResult, reply: string, questions: string[]) {
    const created = await this.repository.createFollowUpSession({ input, ai, reply, questions });
    structuredLog('info', 'support.session.created', {
      mode: 'follow_up',
      source: input.source,
      inquiryId: created.inquiryId,
      sessionId: created.sessionId,
      clientId: input.clientId ?? null,
      category: ai.category,
      priority: ai.priority,
    });
    return created;
  }

  async createEscalatedCase(input: NormalizedIntakeInput, ai: IntakeAiResult, reply: string) {
    const created = await this.repository.createEscalatedCase({ input, ai, reply });
    structuredLog('info', 'support.session.created', {
      mode: 'escalated',
      source: input.source,
      inquiryId: created.inquiryId,
      sessionId: created.sessionId,
      clientId: input.clientId ?? null,
      category: ai.category,
      priority: ai.priority,
    });
    return created;
  }

  async getBySessionId(sessionId: string) {
    return this.repository.getBySessionId(sessionId);
  }

  async appendInboundReply(
    sessionId: string,
    message: string,
    ownership: { clientId?: string; publicSessionToken?: string } = {},
  ) {
    const inquiry = await this.repository.getBySessionId(sessionId);
    this.assertReplyOwnership(inquiry, ownership);
    const followUpState = this.asObject(inquiry.followUpStateJson);
    await this.repository.appendInboundReply({
      inquiryId: inquiry.id,
      message,
      email: inquiry.email,
      source: inquiry.sourceKind as 'PUBLIC' | 'CLIENT',
      history: this.asArray(followUpState?.history),
    });
    structuredLog('info', 'support.reply.received', {
      inquiryId: inquiry.id,
      sessionId,
      source: inquiry.sourceKind,
      clientId: inquiry.clientId ?? null,
    });
    return inquiry;
  }

  async markNeedsFollowUp(sessionId: string, ai: IntakeAiResult, reply: string, questions: string[]) {
    const inquiry = await this.repository.getBySessionId(sessionId);
    const followUpState = this.asObject(inquiry.followUpStateJson);
    await this.repository.markNeedsFollowUp({
      inquiryId: inquiry.id,
      ai,
      reply,
      questions,
      history: this.asArray(followUpState?.history),
      source: inquiry.sourceKind as 'PUBLIC' | 'CLIENT',
      email: inquiry.email,
    });
    return inquiry;
  }

  async markResolvedByAi(sessionId: string, ai: IntakeAiResult, reply: string) {
    const inquiry = await this.repository.getBySessionId(sessionId);
    const followUpState = this.asObject(inquiry.followUpStateJson);
    await this.repository.markResolvedByAi({
      inquiryId: inquiry.id,
      ai,
      reply,
      history: this.asArray(followUpState?.history),
      source: inquiry.sourceKind as 'PUBLIC' | 'CLIENT',
      email: inquiry.email,
    });
    return inquiry;
  }

  async escalateExistingSession(sessionId: string, ai: IntakeAiResult, reply: string) {
    const inquiry = await this.repository.getBySessionId(sessionId);
    const followUpState = this.asObject(inquiry.followUpStateJson);
    await this.repository.escalateExistingSession({
      inquiryId: inquiry.id,
      ai,
      reply,
      history: this.asArray(followUpState?.history),
      source: inquiry.sourceKind as 'PUBLIC' | 'CLIENT',
      email: inquiry.email,
    });
    return inquiry;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private assertReplyOwnership(
    inquiry: {
      sourceKind: unknown;
      clientId: string | null;
      metadataJson?: unknown;
    },
    ownership: { clientId?: string; publicSessionToken?: string },
  ) {
    if (inquiry.sourceKind === 'CLIENT') {
      if (!ownership.clientId || ownership.clientId !== inquiry.clientId) {
        structuredLog('warn', 'support.ownership.denied', {
          source: 'CLIENT',
          inquiryClientId: inquiry.clientId,
          requesterClientId: ownership.clientId ?? null,
        });
        throw new ForbiddenException('Support session is not available for this client');
      }
      return;
    }

    const token = ownership.publicSessionToken?.trim();
    if (!token) {
      structuredLog('warn', 'support.ownership.denied', {
        source: 'PUBLIC',
        reason: 'missing_public_session_token',
      });
      throw new UnauthorizedException('Missing public support session token');
    }

    const metadata = this.asObject(inquiry.metadataJson);
    const intake = this.asObject(metadata?.intake);
    const expectedHash =
      typeof intake?.publicSessionTokenHash === 'string'
        ? intake.publicSessionTokenHash
        : null;

    if (!expectedHash || this.repository.hashPublicSessionToken(token) !== expectedHash) {
      structuredLog('warn', 'support.ownership.denied', {
        source: 'PUBLIC',
        reason: 'invalid_public_session_token',
      });
      throw new ForbiddenException('Support session is not available for this requester');
    }
  }
}
