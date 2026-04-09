import { Injectable } from '@nestjs/common';
import { IntakeAiResult, NormalizedIntakeInput } from '../intake/intake.types';
import { SupportCaseRepository } from './support-case.repository';

@Injectable()
export class SupportCaseService {
  constructor(private readonly repository: SupportCaseRepository) {}

  async createFollowUpSession(input: NormalizedIntakeInput, ai: IntakeAiResult, reply: string, questions: string[]) {
    return this.repository.createFollowUpSession({ input, ai, reply, questions });
  }

  async createEscalatedCase(input: NormalizedIntakeInput, ai: IntakeAiResult, reply: string) {
    return this.repository.createEscalatedCase({ input, ai, reply });
  }

  async getBySessionId(sessionId: string) {
    return this.repository.getBySessionId(sessionId);
  }

  async appendInboundReply(sessionId: string, message: string) {
    const inquiry = await this.repository.getBySessionId(sessionId);
    const followUpState = this.asObject(inquiry.followUpStateJson);
    await this.repository.appendInboundReply({
      inquiryId: inquiry.id,
      message,
      email: inquiry.email,
      source: inquiry.sourceKind as 'PUBLIC' | 'CLIENT',
      history: this.asArray(followUpState?.history),
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
}
