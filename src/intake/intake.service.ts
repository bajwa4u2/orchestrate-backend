import { Injectable } from '@nestjs/common';
import { IntakeAiService } from '../ai/intake-ai.service';
import { SupportCaseService } from '../support/support-case.service';
import {
  IntakeAiResult,
  IntakeResponse,
  NormalizedIntakeInput,
} from './intake.types';

@Injectable()
export class IntakeService {
  constructor(
    private readonly ai: IntakeAiService,
    private readonly supportCases: SupportCaseService,
  ) {}

  async handlePublic(input: NormalizedIntakeInput): Promise<IntakeResponse> {
    const normalizedType = this.normalizeHint(input.inquiryTypeHint);
    const normalizedMessage = (input.message || '').trim();
    const loweredMessage = normalizedMessage.toLowerCase();

    const directKnowledgeResponse = this.resolveDirectKnowledge(
      normalizedType,
      loweredMessage,
      input,
    );

    if (directKnowledgeResponse) {
      return directKnowledgeResponse;
    }

    const ai = await this.ai.classify(input);

    if (!ai.requiresHuman && ai.confidence >= 0.72) {
      return {
        status: 'resolved',
        reply: this.withAcknowledgement(
          ai.suggestedReply || 'I can help with that.',
        ),
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId: null,
        category: ai.category,
        priority: ai.priority,
      };
    }

    if (ai.shouldAskFollowUp) {
      const followUpReply = this.buildFollowUpReply(ai, normalizedType);
      const followUpQuestions = this.normalizeQuestions(ai.followUpQuestions);

      const persisted = await this.supportCases.createFollowUpSession(
        input,
        ai,
        followUpReply,
        followUpQuestions,
      );

      return {
        status: 'needs_follow_up',
        reply: followUpReply,
        questions: followUpQuestions,
        caseCreated: false,
        caseId: null,
        sessionId: persisted.sessionId,
        category: ai.category,
        priority: ai.priority,
      };
    }

    const escalatedReply = this.buildEscalationReply(ai, input);
    const persisted = await this.supportCases.createEscalatedCase(
      input,
      ai,
      escalatedReply,
    );

    return {
      status: 'escalated',
      reply: escalatedReply,
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
    const combinedMessage = this.buildReplyContext(
      inquiry.message,
      inquiry.followUpStateJson,
      message,
    );

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

    if (!ai.requiresHuman && ai.confidence >= 0.72) {
      const resolvedReply = this.withAcknowledgement(
        ai.suggestedReply || 'That should take care of it.',
      );

      await this.supportCases.markResolvedByAi(sessionId, ai, resolvedReply);

      return {
        status: 'resolved',
        reply: resolvedReply,
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId,
        category: ai.category,
        priority: ai.priority,
      };
    }

    if (ai.shouldAskFollowUp) {
      const followUpReply = this.buildFollowUpReply(
        ai,
        inquiry.category ? String(inquiry.category).toLowerCase() : null,
      );
      const followUpQuestions = this.normalizeQuestions(ai.followUpQuestions);

      await this.supportCases.markNeedsFollowUp(
        sessionId,
        ai,
        followUpReply,
        followUpQuestions,
      );

      return {
        status: 'needs_follow_up',
        reply: followUpReply,
        questions: followUpQuestions,
        caseCreated: false,
        caseId: null,
        sessionId,
        category: ai.category,
        priority: ai.priority,
      };
    }

    const escalatedReply = this.buildEscalationReply(ai, {
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

    const escalated = await this.supportCases.escalateExistingSession(
      sessionId,
      ai,
      escalatedReply,
    );

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

  private async resolveDirectKnowledge(
    normalizedType: string | null,
    loweredMessage: string,
    input: NormalizedIntakeInput,
  ): Promise<IntakeResponse | null> {
    if (
      normalizedType === 'pricing' ||
      normalizedType === 'service_fit' ||
      this.looksLikePricingQuestion(loweredMessage)
    ) {
      return {
        status: 'resolved',
        reply:
          'I can help with that. Orchestrate operates in two lanes. Opportunity covers lead generation through meetings. Revenue includes that operating flow plus billing continuity, including invoices, payments, agreements, and statements. Focused covers one country across multiple regions, Multi covers multiple countries and regions, and Precision adds tighter city-level targeting with include or exclude control.',
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId: null,
        category: 'pricing',
        priority: 'low',
      };
    }

    if (normalizedType === 'onboarding' || this.looksLikeOnboardingQuestion(loweredMessage)) {
      return {
        status: 'resolved',
        reply:
          'Happy to guide you. After account creation, the flow moves through verification, operating profile setup, subscription activation, and then service begins.',
        questions: [],
        caseCreated: false,
        caseId: null,
        sessionId: null,
        category: 'onboarding',
        priority: 'low',
      };
    }

    if (normalizedType === 'billing_support' || this.looksLikeBillingQuestion(loweredMessage)) {
      const hasBillingSpecifics = this.containsAny(loweredMessage, [
        'charged',
        'invoice',
        'payment',
        'refund',
        'billing',
        'subscription',
        'checkout',
        'card',
        'failed',
      ]);

      if (!hasBillingSpecifics || loweredMessage.length < 24) {
        const followUpAi: IntakeAiResult = {
          category: 'billing',
          intent: 'issue',
          priority: 'high',
          confidence: 0.95,
          requiresHuman: true,
          shouldAskFollowUp: true,
          summary: 'Billing inquiry needs one clarifying detail before routing.',
          suggestedReply:
            'I can help with that. Tell me whether this is about a subscription, a checkout attempt, or an invoice or payment issue.',
          missingFields: ['billing_scope'],
          followUpQuestions: [
            'Is this about a current subscription, a recent checkout attempt, or an invoice or payment issue?',
          ],
        };

        return await this.createFollowUpResponse(input, followUpAi);
      }

      const escalatedAi: IntakeAiResult = {
        category: 'billing',
        intent: 'issue',
        priority: 'high',
        confidence: 0.98,
        requiresHuman: true,
        shouldAskFollowUp: false,
        summary: 'Billing request routed for review.',
        suggestedReply:
          input.source === 'PUBLIC'
            ? 'I can help with that. This looks like a billing issue that should be reviewed directly, so I’ve routed it for follow-up.'
            : 'I’ve routed this billing issue for review.',
        missingFields: [],
        followUpQuestions: [],
      };

      return await this.createEscalationResponse(input, escalatedAi, escalatedAi.suggestedReply);
    }

    return null;
  }

  private async createFollowUpResponse(
    input: NormalizedIntakeInput,
    ai: IntakeAiResult,
  ): Promise<IntakeResponse> {
    const followUpReply = this.buildFollowUpReply(ai, this.normalizeHint(input.inquiryTypeHint));
    const followUpQuestions = this.normalizeQuestions(ai.followUpQuestions);

    const persisted = await this.supportCases.createFollowUpSession(
      input,
      ai,
      followUpReply,
      followUpQuestions,
    );

    return {
      status: 'needs_follow_up',
      reply: followUpReply,
      questions: followUpQuestions,
      caseCreated: false,
      caseId: null,
      sessionId: persisted.sessionId,
      category: ai.category,
      priority: ai.priority,
    };
  }

  private async createEscalationResponse(
    input: NormalizedIntakeInput,
    ai: IntakeAiResult,
    reply: string,
  ): Promise<IntakeResponse> {
    const persisted = await this.supportCases.createEscalatedCase(input, ai, reply);

    return {
      status: 'escalated',
      reply,
      questions: [],
      caseCreated: true,
      caseId: persisted.inquiryId,
      sessionId: persisted.sessionId,
      category: ai.category,
      priority: ai.priority,
    };
  }

  private buildFollowUpReply(
    ai: IntakeAiResult,
    normalizedType: string | null,
  ): string {
    if (ai.category === 'pricing' || normalizedType === 'pricing' || normalizedType === 'service_fit') {
      return 'I can help with that. One detail will help me point you to the right plan.';
    }

    if (ai.category === 'billing' || normalizedType === 'billing_support') {
      return 'I can help with that. I need one detail before I route this correctly.';
    }

    if (ai.category === 'technical') {
      return 'I can help with that. Let me understand one technical detail first.';
    }

    return 'I can help with that. Let me understand one thing first.';
  }

  private buildEscalationReply(
    ai: IntakeAiResult,
    input: NormalizedIntakeInput,
  ): string {
    if (ai.category === 'billing') {
      return input.source === 'PUBLIC'
        ? 'I can help with that. This looks like a billing issue that should be reviewed directly, so I’ve routed it for follow-up.'
        : 'I’ve routed this billing issue for review.';
    }

    if (ai.category === 'technical') {
      return input.source === 'PUBLIC'
        ? 'I can help with that. This looks like something the team should review directly, so I’ve routed it for follow-up.'
        : 'I’ve routed this technical request for review.';
    }

    if (ai.category === 'partnership' || ai.category === 'sales') {
      return input.source === 'PUBLIC'
        ? 'I can help with that. This is better handled directly, so I’ve routed it for follow-up.'
        : 'I’ve routed this request for review.';
    }

    return input.source === 'PUBLIC'
      ? 'I can help with that. This needs a closer review, so I’ve routed it for follow-up.'
      : 'I’ve routed this request for review.';
  }

  private normalizeQuestions(questions?: string[]): string[] {
    return Array.isArray(questions)
      ? questions.map((q) => q.trim()).filter(Boolean)
      : [];
  }

  private looksLikePricingQuestion(text: string): boolean {
    return this.containsAny(text, [
      'plan',
      'plans',
      'pricing',
      'price',
      'cost',
      'tier',
      'tiers',
      'focused',
      'multi',
      'precision',
      'opportunity',
      'revenue',
    ]);
  }

  private looksLikeOnboardingQuestion(text: string): boolean {
    return this.containsAny(text, [
      'onboard',
      'onboarding',
      'setup',
      'set up',
      'start',
      'begin',
      'get started',
      'how does it work',
      'activation',
      'activate',
      'verify',
    ]);
  }

  private looksLikeBillingQuestion(text: string): boolean {
    return this.containsAny(text, [
      'billing',
      'invoice',
      'payment',
      'refund',
      'charged',
      'subscription',
      'checkout',
      'card',
    ]);
  }

  private withAcknowledgement(text: string): string {
    const trimmed = text.trim();
    if (
      trimmed.startsWith('I can help with that.') ||
      trimmed.startsWith('Happy to guide you.') ||
      trimmed.startsWith('I’ve ') ||
      trimmed.startsWith('This ') ||
      trimmed.startsWith('Opportunity ') ||
      trimmed.startsWith('Revenue ')
    ) {
      return trimmed;
    }

    return `I can help with that. ${trimmed}`;
  }

  private normalizeHint(value?: string | null): string | null {
    if (!value) return null;
    return value.trim().toLowerCase();
  }

  private containsAny(text: string, candidates: string[]): boolean {
    return candidates.some((candidate) => text.includes(candidate));
  }

  private buildReplyContext(
    initialMessage: string,
    followUpStateJson: unknown,
    latestReply: string,
  ): string {
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
