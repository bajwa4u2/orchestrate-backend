import { Injectable } from '@nestjs/common';
import { LeadCandidate } from '../contracts/lead.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { normalizeLeadCandidates, buildLeadPrompt } from '../prompts/lead.prompt';
import { OpenAiProvider } from '../providers/openai.provider';

@Injectable()
export class LeadAgent {
  constructor(private readonly openAiProvider: OpenAiProvider) {}

  async generate(strategy: StrategyBrief, leadCount: number): Promise<LeadCandidate[]> {
    const result = await this.openAiProvider.generateStructured<{ leads: LeadCandidate[] }>({
      model: this.openAiProvider.getFastModel(),
      temperature: 0.3,
      systemPrompt:
        'You generate realistic B2B lead candidates. Return valid JSON only. Do not add commentary.',
      userPrompt: buildLeadPrompt(strategy, leadCount),
    });

    return normalizeLeadCandidates(result);
  }
}
