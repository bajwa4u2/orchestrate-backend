import { Injectable } from '@nestjs/common';
import { LeadCandidate } from '../contracts/lead.contract';
import { MessageDraft } from '../contracts/message.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { AiEngineService } from '../core/ai-engine.service';
import { buildWriterPrompt } from '../prompts/writer.prompt';

@Injectable()
export class WriterAgent {
  constructor(private readonly aiEngine: AiEngineService) {}

  async generate(strategy: StrategyBrief, lead: LeadCandidate): Promise<MessageDraft> {
    const result = await this.aiEngine.structured<MessageDraft>({
      purpose: 'generation.message',
      modelTier: 'balanced',
      systemPrompt:
        'You write direct and credible B2B outbound emails. Return valid JSON only. Avoid hype, slang, and exaggerated claims.',
      userPrompt: buildWriterPrompt(strategy, lead),
      schema: this.schema(),
      retries: 2,
      metadata: { agent: 'writer', leadEmail: lead.email ?? null },
    });

    return result.output;
  }

  private schema() {
    return {
      name: 'orchestrate_message_draft',
      strict: false,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subject: { type: 'string' },
          body: { type: 'string' },
          tone: { type: 'string' },
          intent: { type: 'string' },
        },
        required: ['subject', 'body', 'tone', 'intent'],
      },
    };
  }
}
