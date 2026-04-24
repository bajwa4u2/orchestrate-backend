import { Injectable } from '@nestjs/common';
import { ServiceProfileInput } from '../contracts/service-profile.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { AiEngineService } from '../core/ai-engine.service';
import { buildStrategyPrompt } from '../prompts/strategy.prompt';

@Injectable()
export class StrategyAgent {
  constructor(private readonly aiEngine: AiEngineService) {}

  async generate(input: ServiceProfileInput): Promise<StrategyBrief> {
    const result = await this.aiEngine.structured<StrategyBrief>({
      purpose: 'generation.strategy',
      modelTier: 'balanced',
      systemPrompt:
        'You create outbound strategy briefs for a B2B automation platform. Return valid JSON only. Keep outputs usable by backend systems.',
      userPrompt: buildStrategyPrompt(input),
      schema: this.schema(),
      retries: 2,
      metadata: { agent: 'strategy' },
    });

    return result.output;
  }

  private schema() {
    return {
      name: 'orchestrate_strategy_brief',
      strict: false,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          icpName: { type: 'string' },
          campaignName: { type: 'string' },
          objective: { type: 'string' },
          offerSummary: { type: 'string' },
          industryTags: { type: 'array', items: { type: 'string' } },
          geoTargets: { type: 'array', items: { type: 'string' } },
          titleKeywords: { type: 'array', items: { type: 'string' } },
          exclusionKeywords: { type: 'array', items: { type: 'string' } },
          painPoints: { type: 'array', items: { type: 'string' } },
          valueAngles: { type: 'array', items: { type: 'string' } },
          tone: { type: 'string' },
          callToAction: { type: 'string' },
          bookingUrlOverride: { type: 'string' },
          segmentNotes: { type: 'string' },
        },
        required: ['icpName', 'campaignName', 'objective', 'offerSummary', 'industryTags', 'geoTargets', 'titleKeywords', 'exclusionKeywords', 'painPoints', 'valueAngles', 'tone', 'callToAction'],
      },
    };
  }
}
