import { Injectable } from '@nestjs/common';
import { IntakeAiService } from '../ai/intake-ai.service';
import { IntakeResponse, NormalizedIntakeInput } from './intake.types';

@Injectable()
export class IntakeService {
  constructor(private readonly ai: IntakeAiService) {}

  async handlePublic(input: NormalizedIntakeInput): Promise<IntakeResponse> {
    const normalizedType = this.normalizeHint(input.inquiryTypeHint);
    const normalizedMessage = (input.message || '').trim();

    // Deterministic first-pass handling for common public inquiries.
    // This gives immediate value even before the real AI provider is wired.
    if (normalizedType === 'pricing' || normalizedType === 'service_fit') {
      return {
        status: 'resolved',
        reply:
          'Opportunity covers lead generation through meetings. Revenue includes that operating flow plus billing continuity, including invoices, payments, agreements, and statements. Focused covers one country across multiple regions, Multi covers multiple countries and regions, and Precision adds tighter city-level targeting and include or exclude control.',
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId: null,
        category: 'pricing',
        priority: 'low',
      };
    }

    if (normalizedType === 'onboarding') {
      return {
        status: 'resolved',
        reply:
          'After contact and account creation, the flow moves through verification, operating profile setup, subscription activation, and then service begins.',
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId: null,
        category: 'onboarding',
        priority: 'low',
      };
    }

    if (normalizedType === 'billing_support') {
      const needsFollowUp =
        !this.containsAny(normalizedMessage.toLowerCase(), [
          'charged',
          'invoice',
          'payment',
          'refund',
          'billing',
          'subscription',
          'checkout',
        ]);

      if (needsFollowUp) {
        return {
          status: 'needs_follow_up',
          reply: 'I need one detail before I route this correctly.',
          questions: ['Is this about a current subscription, a recent checkout attempt, or an invoice or payment issue?'],
          caseCreated: false,
          caseId: null,
          sessionId: this.generateSessionId(),
          category: 'billing',
          priority: 'high',
        };
      }

      return {
        status: 'escalated',
        reply: 'Your billing request has been routed for review.',
        questions: [],
        caseCreated: true,
        caseId: this.generateCaseId(),
        sessionId: this.generateSessionId(),
        category: 'billing',
        priority: 'high',
      };
    }

    // Fall back to AI classification for everything else.
    const ai = await this.ai.classify(input);

    if (!ai.requiresHuman && ai.confidence >= 0.75) {
      return {
        status: 'resolved',
        reply: ai.suggestedReply || '',
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId: null,
        category: ai.category,
        priority: ai.priority,
      };
    }

    if (ai.shouldAskFollowUp) {
      return {
        status: 'needs_follow_up',
        reply: 'I need one detail before I route this correctly.',
        questions: ai.followUpQuestions ?? [],
        caseCreated: false,
        caseId: null,
        sessionId: this.generateSessionId(),
        category: ai.category,
        priority: ai.priority,
      };
    }

    return {
      status: 'escalated',
      reply: 'Your request has been routed for review.',
      questions: [],
      caseCreated: true,
      caseId: this.generateCaseId(),
      sessionId: this.generateSessionId(),
      category: ai.category,
      priority: ai.priority,
    };
  }

  private normalizeHint(value?: string | null): string | null {
    if (!value) return null;
    return value.trim().toLowerCase();
  }

  private containsAny(text: string, candidates: string[]): boolean {
    return candidates.some((candidate) => text.includes(candidate));
  }

  private generateSessionId(): string {
    return 'sess_' + Math.random().toString(36).substring(2, 10);
  }

  private generateCaseId(): string {
    return 'inq_' + Math.random().toString(36).substring(2, 10);
  }
}
