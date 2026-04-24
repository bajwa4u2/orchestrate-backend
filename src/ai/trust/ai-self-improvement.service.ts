import { Injectable } from '@nestjs/common';
import { AiImprovementPlanDto, AiImprovementPlanResult } from '../contracts/ai-trust.contract';
import { AiEngineService } from '../core/ai-engine.service';

@Injectable()
export class AiSelfImprovementService {
  constructor(private readonly engine: AiEngineService) {}

  async plan(input: AiImprovementPlanDto): Promise<AiImprovementPlanResult> {
    const result = await this.engine.structured<AiImprovementPlanResult>({
      purpose: 'autonomy.self_improvement',
      systemPrompt: [
        'You are Orchestrate AI self-improvement planner.',
        'Your job is to move AI from working to trusted without wiring runtime actions yet.',
        'Focus on evaluation coverage, schema reliability, model routing, cost control, self-correction, and safety gates.',
        'Return concrete priorities, not vague advice.',
      ].join('\n'),
      input,
      schema: this.schema(),
      modelTier: 'reasoning',
      retries: 1,
      metadata: { trustLayer: 'self_improvement' },
    });
    return result.output;
  }

  private schema() {
    return {
      name: 'orchestrate_ai_improvement_plan',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetTrustLevel: { type: 'string' },
          currentTrustLevel: { type: 'string' },
          priorities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                reason: { type: 'string' },
                impact: { type: 'string' },
                effort: { type: 'string' },
                filesOrServices: { type: 'array', items: { type: 'string' } },
                acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'reason', 'impact', 'effort', 'filesOrServices', 'acceptanceCriteria'],
            },
          },
          evaluationCasesToAdd: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                domain: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['title', 'domain', 'reason'],
            },
          },
          guardrailsToTighten: { type: 'array', items: { type: 'string' } },
          providerRoutingChanges: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'targetTrustLevel',
          'currentTrustLevel',
          'priorities',
          'evaluationCasesToAdd',
          'guardrailsToTighten',
          'providerRoutingChanges',
        ],
      },
    };
  }
}
