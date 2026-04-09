import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { IntakeAiResult, NormalizedIntakeInput } from '../intake/intake.types';
import { INTAKE_SYSTEM_PROMPT } from './prompts/intake.system.prompt';

@Injectable()
export class IntakeAiService {
  private readonly client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 30000),
  });

  private readonly model =
    process.env.OPENAI_MODEL_FAST || process.env.OPENAI_MODEL_PRIMARY || 'gpt-4o-mini';

  private readonly allowedCategories: IntakeAiResult['category'][] = [
    'pricing',
    'billing',
    'support',
    'technical',
    'onboarding',
    'sales',
    'partnership',
    'compliance',
    'other',
  ];

  private readonly allowedPriorities: IntakeAiResult['priority'][] = ['low', 'medium', 'high'];
  private readonly allowedIntents: IntakeAiResult['intent'][] = [
    'question',
    'issue',
    'request',
    'complaint',
  ];

  async classify(input: NormalizedIntakeInput): Promise<IntakeAiResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: INTAKE_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: this.buildPrompt(input),
          },
        ],
      });

      const raw = response.choices?.[0]?.message?.content || '';
      const parsed = this.safeParse(raw);

      if (!parsed) {
        return this.fallback(input);
      }

      return this.validate(parsed, input);
    } catch {
      return this.fallback(input);
    }
  }

  private buildPrompt(input: NormalizedIntakeInput): string {
    const parts = [
      `Source: ${input.source}`,
      `Message: ${JSON.stringify((input.message || '').trim())}`,
      `Inquiry hint: ${input.inquiryTypeHint || 'none'}`,
      `Source page: ${input.sourcePage || 'unknown'}`,
      `Plan context: ${input.planContext || 'unknown'}`,
      `Tier context: ${input.tierContext || 'unknown'}`,
      `Has email: ${input.email ? 'yes' : 'no'}`,
      `Has company: ${input.company ? 'yes' : 'no'}`,
      '',
      'Return the structured JSON classification only.',
      'Prefer direct answers for ordinary Orchestrate product questions.',
      'Use follow-up before escalation when one missing detail would help.',
    ];

    return parts.join('\n');
  }

  private safeParse(raw: string): unknown | null {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private validate(data: unknown, input: NormalizedIntakeInput): IntakeAiResult {
    const value = this.asRecord(data);

    const category = this.allowedCategories.includes(value.category as IntakeAiResult['category'])
      ? (value.category as IntakeAiResult['category'])
      : this.inferCategoryFallback(input);

    const intent = this.allowedIntents.includes(value.intent as IntakeAiResult['intent'])
      ? (value.intent as IntakeAiResult['intent'])
      : 'question';

    const priority = this.allowedPriorities.includes(value.priority as IntakeAiResult['priority'])
      ? (value.priority as IntakeAiResult['priority'])
      : 'low';

    const confidence =
      typeof value.confidence === 'number'
        ? Math.max(0, Math.min(1, value.confidence))
        : 0.55;

    const suggestedReply = this.cleanReply(
      typeof value.suggestedReply === 'string' ? value.suggestedReply : '',
      category,
    );

    const followUpQuestions = Array.isArray(value.followUpQuestions)
      ? value.followUpQuestions.filter((item): item is string => typeof item === 'string').slice(0, 2)
      : [];

    const missingFields = Array.isArray(value.missingFields)
      ? value.missingFields.filter((item): item is string => typeof item === 'string').slice(0, 4)
      : [];

    const shouldAskFollowUp =
      typeof value.shouldAskFollowUp === 'boolean'
        ? value.shouldAskFollowUp
        : followUpQuestions.length > 0;

    const requiresHuman =
      typeof value.requiresHuman === 'boolean'
        ? value.requiresHuman
        : category === 'billing' || category === 'technical';

    return {
      category,
      intent,
      priority,
      confidence,
      requiresHuman,
      shouldAskFollowUp,
      summary:
        typeof value.summary === 'string' && value.summary.trim().length > 0
          ? value.summary.trim()
          : 'Structured intake classification completed.',
      suggestedReply,
      missingFields,
      followUpQuestions,
    };
  }

  private cleanReply(reply: string, category: IntakeAiResult['category']): string {
    const text = reply.trim();
    if (text.length > 0) {
      return text;
    }

    if (category === 'pricing') {
      return 'I can help with that. Orchestrate operates in two lanes, Opportunity and Revenue. Opportunity focuses on lead generation through meetings, while Revenue extends that operating flow with billing continuity, including invoices, payments, agreements, and statements.';
    }

    if (category === 'onboarding') {
      return 'Happy to help with that. The usual flow is account creation, email verification, operating profile setup, subscription activation, and then service begins.';
    }

    return 'I can help with that.';
  }

  private inferCategoryFallback(input: NormalizedIntakeInput): IntakeAiResult['category'] {
    const text = `${input.inquiryTypeHint || ''} ${input.message || ''}`.toLowerCase();

    if (this.containsAny(text, ['price', 'pricing', 'plan', 'tier', 'cost'])) return 'pricing';
    if (this.containsAny(text, ['onboard', 'setup', 'start', 'begin', 'activate'])) return 'onboarding';
    if (this.containsAny(text, ['invoice', 'payment', 'refund', 'billing', 'charge', 'subscription'])) return 'billing';
    if (this.containsAny(text, ['partner', 'partnership'])) return 'partnership';
    if (this.containsAny(text, ['technical', 'bug', 'error', 'broken', 'issue', 'login'])) return 'technical';
    if (this.containsAny(text, ['sales', 'demo', 'service fit'])) return 'sales';

    return 'other';
  }

  private containsAny(text: string, words: string[]): boolean {
    return words.some((word) => text.includes(word));
  }

  private fallback(input: NormalizedIntakeInput): IntakeAiResult {
    const category = this.inferCategoryFallback(input);
    const followUpQuestion =
      category === 'pricing'
        ? 'Are you comparing the Opportunity lane or the Revenue lane?'
        : category === 'billing'
          ? 'Is this about a current subscription, a recent checkout attempt, or an invoice or payment issue?'
          : 'Is this about pricing, onboarding, billing, technical support, or something else?';

    return {
      category,
      intent: 'question',
      priority: category === 'billing' || category === 'technical' ? 'high' : 'medium',
      confidence: 0.35,
      requiresHuman: false,
      shouldAskFollowUp: true,
      summary: 'Fallback intake classification used.',
      suggestedReply: 'I can help with that. Let me understand one thing first.',
      missingFields: ['scope'],
      followUpQuestions: [followUpQuestion],
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
