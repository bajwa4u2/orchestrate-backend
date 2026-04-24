import { Injectable } from '@nestjs/common';
import { SequenceStepDraft } from '../contracts/sequence.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { AiEngineService } from '../core/ai-engine.service';
import { buildSequencePrompt } from '../prompts/sequence.prompt';

@Injectable()
export class SequenceAgent {
  constructor(private readonly aiEngine: AiEngineService) {}

  async generate(strategy: StrategyBrief, stepCount: number): Promise<SequenceStepDraft[]> {
    const result = await this.aiEngine.structured<{ steps: SequenceStepDraft[] }>({
      purpose: 'generation.sequence',
      modelTier: 'fast',
      systemPrompt:
        'You create practical outbound follow-up sequences. Return valid JSON only.',
      userPrompt: buildSequencePrompt(strategy, stepCount),
      schema: this.schema(),
      retries: 2,
      metadata: { agent: 'sequence', stepCount },
    });

    return Array.isArray(result.output?.steps) ? result.output.steps : [];
  }

  private schema() {
    return {
      name: 'orchestrate_sequence_steps',
      strict: false,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                orderIndex: { type: 'number' },
                waitDays: { type: 'number' },
                subjectTemplate: { type: 'string' },
                bodyTemplate: { type: 'string' },
                instructionText: { type: 'string' },
              },
              required: ['orderIndex', 'waitDays'],
            },
          },
        },
        required: ['steps'],
      },
    };
  }
}
