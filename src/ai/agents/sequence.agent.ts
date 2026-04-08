import { Injectable } from '@nestjs/common';
import { SequenceStepDraft } from '../contracts/sequence.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { buildSequencePrompt } from '../prompts/sequence.prompt';
import { OpenAiProvider } from '../providers/openai.provider';

@Injectable()
export class SequenceAgent {
  constructor(private readonly openAiProvider: OpenAiProvider) {}

  async generate(strategy: StrategyBrief, stepCount: number): Promise<SequenceStepDraft[]> {
    const result = await this.openAiProvider.generateStructured<{ steps: SequenceStepDraft[] }>({
      model: this.openAiProvider.getFastModel(),
      temperature: 0.25,
      systemPrompt:
        'You create practical outbound follow-up sequences. Return valid JSON only.',
      userPrompt: buildSequencePrompt(strategy, stepCount),
    });

    return Array.isArray(result?.steps) ? result.steps : [];
  }
}
