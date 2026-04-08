import { Injectable } from '@nestjs/common';
import { LeadCandidate } from '../contracts/lead.contract';
import { MessageDraft } from '../contracts/message.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { buildWriterPrompt } from '../prompts/writer.prompt';
import { OpenAiProvider } from '../providers/openai.provider';

@Injectable()
export class WriterAgent {
  constructor(private readonly openAiProvider: OpenAiProvider) {}

  async generate(strategy: StrategyBrief, lead: LeadCandidate): Promise<MessageDraft> {
    return this.openAiProvider.generateStructured<MessageDraft>({
      model: this.openAiProvider.getPrimaryModel(),
      temperature: 0.35,
      systemPrompt:
        'You write direct and credible B2B outbound emails. Return valid JSON only. Avoid hype, slang, and exaggerated claims.',
      userPrompt: buildWriterPrompt(strategy, lead),
    });
  }
}
