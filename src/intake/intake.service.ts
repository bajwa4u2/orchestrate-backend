import { Injectable } from '@nestjs/common';
import { IntakeAiService } from '../ai/intake-ai.service';
import { SupportCaseService } from '../support/support-case.service';
import { IntakeResponse, NormalizedIntakeInput } from './intake.types';

@Injectable()
export class IntakeService {
  constructor(
    private readonly ai: IntakeAiService,
    private readonly supportCases: SupportCaseService,
  ) {}

  async handlePublic(input: NormalizedIntakeInput): Promise<IntakeResponse> {
    const normalizedType = this.normalizeHint(input.inquiryTypeHint);
    const normalizedMessage = (input.message || '').trim();

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
      const needsFollowUp = !this.containsAny(normalizedMessage.toLowerCase(), [
        'charged',
        'invoice',
        'payment',
        'refund',
        'billing',
        'subscription',
        'checkout',
      ]);

      if (needsFollowUp) {
        const followUpAi = {
          category: 'billing',
          intent: 'issue',
          priority: 'high',
          confidence: 0.95,
          requiresHuman: true,
          shouldAskFollowUp: true,
          summary: 'Billing inquiry needs one clarifying detail before routing.',
          suggestedReply: 'I need one detail before I route this correctly.',
          missingFields: ['billing_scope'],
          followUpQuestions: ['Is this about a current subscription, a recent checkout attempt, or an invoice or payment issue?'],
        } as const;

        const persisted = await this.supportCases.createFollowUpSession(
          input,
          followUpAi,
          followUpAi.suggestedReply,
          followUpAi.followUpQuestions,
        );

        return {
          status: 'needs_follow_up',
          reply: followUpAi.suggestedReply,
          questions: [...followUpAi.followUpQuestions],
          caseCreated: false,
          caseId: null,
          sessionId: persisted.sessionId,
          category: followUpAi.category,
          priority: followUpAi.priority,
        };
      }

      const escalatedAi = {
        category: 'billing',
        intent: 'issue',
        priority: 'high',
        confidence: 0.98,
        requiresHuman: true,
        shouldAskFollowUp: false,
        summary: 'Billing request routed for review.',
        suggestedReply: 'Your billing request has been routed for review.',
        missingFields: [],
        followUpQuestions: [],
      } as const;

      const persisted = await this.supportCases.createEscalatedCase(
        input,
        escalatedAi,
        escalatedAi.suggestedReply,
      );

      return {
        status: 'escalated',
        reply: escalatedAi.suggestedReply,
        questions: [],
        caseCreated: true,
        caseId: persisted.inquiryId,
        sessionId: persisted.sessionId,
        category: escalatedAi.category,
        priority: escalatedAi.priority,
      };
    }

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
      const persisted = await this.supportCases.createFollowUpSession(
        input,
        ai,
        'I need one detail before I route this correctly.',
        ai.followUpQuestions ?? [],
      );

      return {
        status: 'needs_follow_up',
        reply: 'I need one detail before I route this correctly.',
        questions: ai.followUpQuestions ?? [],
        caseCreated: false,
        caseId: null,
        sessionId: persisted.sessionId,
        category: ai.category,
        priority: ai.priority,
      };
    }

    const persisted = await this.supportCases.createEscalatedCase(
      input,
      ai,
      'Your request has been routed for review.',
    );

    return {
      status: 'escalated',
      reply: 'Your request has been routed for review.',
      questions: [],
      caseCreated: true,
      caseId: persisted.inquiryId,
      sessionId: persisted.sessionId,
      category: ai.category,
      priority: ai.priority,
    };
  }

  async replyPublic(sessionId: string, message: string): Promise<IntakeResponse> {
    const inquiry = await this.supportCases.appendInboundReply(sessionId, message);
    const combinedMessage = this.buildReplyContext(inquiry.message, inquiry.followUpStateJson, message);

    const ai = await this.ai.classify({
      source: inquiry.sourceKind as 'PUBLIC' | 'CLIENT',
      name: inquiry.name,
      email: inquiry.email,
      company: inquiry.company,
      userId: inquiry.userId,
      clientId: inquiry.clientId,
      message: combinedMessage,
      sourcePage: inquiry.sourcePage,
      planContext: this.asPlanContext(inquiry.planContext),
      tierContext: this.asTierContext(inquiry.tierContext),
      inquiryTypeHint: inquiry.category ? String(inquiry.category).toLowerCase() : null,
    });

    if (!ai.requiresHuman && ai.confidence >= 0.75) {
      await this.supportCases.markResolvedByAi(sessionId, ai, ai.suggestedReply || 'Thanks. That resolves the request.');
      return {
        status: 'resolved',
        reply: ai.suggestedReply || 'Thanks. That resolves the request.',
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId,
        category: ai.category,
        priority: ai.priority,
      };
    }

    if (ai.shouldAskFollowUp) {
      const followUpReply = 'I need one detail before I route this correctly.';
      await this.supportCases.markNeedsFollowUp(sessionId, ai, followUpReply, ai.followUpQuestions ?? []);
      return {
        status: 'needs_follow_up',
        reply: followUpReply,
        questions: ai.followUpQuestions ?? [],
        caseCreated: false,
        caseId: null,
        sessionId,
        category: ai.category,
        priority: ai.priority,
      };
    }

    const escalatedReply = 'Your request has been routed for review.';
    const escalated = await this.supportCases.escalateExistingSession(sessionId, ai, escalatedReply);
    return {
      status: 'escalated',
      reply: escalatedReply,
      questions: [],
      caseCreated: true,
      caseId: escalated.id,
      sessionId,
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

  private buildReplyContext(initialMessage: string, followUpStateJson: unknown, latestReply: string): string {
    const history = this.extractHistory(followUpStateJson)
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const role = typeof entry.role === 'string' ? entry.role : 'unknown';
        const message = typeof entry.message === 'string' ? entry.message : '';
        return `${role}: ${message}`.trim();
      })
      .filter(Boolean)
      .join('\n');

    return [
      `Initial request: ${initialMessage}`,
      history ? `Previous follow-up context:\n${history}` : null,
      `Latest user reply: ${latestReply}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private extractHistory(value: unknown): Array<Record<string, unknown>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const history = (value as Record<string, unknown>).history;
    return Array.isArray(history) ? (history as Array<Record<string, unknown>>) : [];
  }

  private asPlanContext(value: unknown): 'opportunity' | 'revenue' | null {
    return value === 'opportunity' || value === 'revenue' ? value : null;
  }

  private asTierContext(value: unknown): 'focused' | 'multi' | 'precision' | null {
    return value === 'focused' || value === 'multi' || value === 'precision' ? value : null;
  }
}
