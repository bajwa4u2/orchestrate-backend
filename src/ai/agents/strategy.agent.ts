import { Injectable } from '@nestjs/common';
import { ServiceProfileInput } from '../contracts/service-profile.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { buildStrategyPrompt } from '../prompts/strategy.prompt';
import { OpenAiProvider } from '../providers/openai.provider';

@Injectable()
export class StrategyAgent {
  constructor(private readonly openAiProvider: OpenAiProvider) {}

  async generate(input: ServiceProfileInput): Promise<StrategyBrief> {
    return this.openAiProvider.generateStructured<StrategyBrief>({
      model: this.openAiProvider.getPrimaryModel(),
      temperature: 0.2,
      systemPrompt:
        'You create outbound strategy briefs for a B2B automation platform. Return valid JSON only. Keep outputs usable by backend systems.',
      userPrompt: buildStrategyPrompt(input),
    });
  }
}
