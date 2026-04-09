import { Injectable } from '@nestjs/common';
import { IntakeAiResult, NormalizedIntakeInput } from '../intake/intake.types';
import OpenAI from 'openai';

@Injectable()
export class IntakeAiService {
  private client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  private allowedCategories = [
    'pricing',
    'onboarding',
    'billing',
    'technical',
    'general',
    'other',
  ];

  private allowedPriorities = ['low', 'medium', 'high'];

  async classify(input: NormalizedIntakeInput): Promise<IntakeAiResult> {
    try {
      const prompt = this.buildPrompt(input);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: this.systemInstruction(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const raw = response.choices?.[0]?.message?.content || '';

      const parsed = this.safeParse(raw);

      if (!parsed) {
        return this.fallback();
      }

      return this.validate(parsed);
    } catch (err) {
      return this.fallback();
    }
  }

  private systemInstruction(): string {
    return `
You are an intake classification engine for a B2B service platform.

Your job:
- Classify user support requests
- Decide if it can be resolved automatically
- Decide if follow-up is needed
- Decide if human escalation is required

STRICT RULES:
- Respond ONLY with valid JSON
- Do NOT include explanations
- Do NOT hallucinate account-specific facts
- If unsure → set requiresHuman = true
- Be conservative with automation

Allowed categories:
pricing, onboarding, billing, technical, general, other

Allowed priorities:
low, medium, high

Output format:
{
  "category": string,
  "intent": "question" | "issue" | "request",
  "priority": "low" | "medium" | "high",
  "confidence": number (0 to 1),
  "requiresHuman": boolean,
  "shouldAskFollowUp": boolean,
  "summary": string,
  "suggestedReply": string,
  "missingFields": string[],
  "followUpQuestions": string[]
}
`;
  }

  private buildPrompt(input: NormalizedIntakeInput): string {
    return `
User message:
"${input.message}"

Context:
- Inquiry hint: ${input.inquiryTypeHint || 'unknown'}

Return structured classification.
`;
  }

  private safeParse(raw: string): any | null {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private validate(data: any): IntakeAiResult {
    const category = this.allowedCategories.includes(data.category)
      ? data.category
      : 'other';

    const priority = this.allowedPriorities.includes(data.priority)
      ? data.priority
      : 'low';

    const confidence =
      typeof data.confidence === 'number'
        ? Math.max(0, Math.min(1, data.confidence))
        : 0.3;

    const requiresHuman =
      typeof data.requiresHuman === 'boolean'
        ? data.requiresHuman
        : true;

    const shouldAskFollowUp =
      typeof data.shouldAskFollowUp === 'boolean'
        ? data.shouldAskFollowUp
        : false;

    return {
      category,
      intent: data.intent || 'question',
      priority,
      confidence,
      requiresHuman,
      shouldAskFollowUp,
      summary: data.summary || 'No summary provided',
      suggestedReply: data.suggestedReply || '',
      missingFields: Array.isArray(data.missingFields)
        ? data.missingFields
        : [],
      followUpQuestions: Array.isArray(data.followUpQuestions)
        ? data.followUpQuestions
        : [],
    };
  }

  private fallback(): IntakeAiResult {
    return {
      category: 'other',
      intent: 'question',
      priority: 'high',
      confidence: 0.2,
      requiresHuman: true,
      shouldAskFollowUp: false,
      summary: 'AI fallback triggered',
      suggestedReply:
        'Thanks for reaching out. Our team will review this and get back to you shortly.',
      missingFields: [],
      followUpQuestions: [],
    };
  }
}