import { Injectable } from '@nestjs/common';
import { AiSelfTriggerPlanDto, AiSelfTriggerPlanResult } from '../contracts/ai-trust.contract';
import { AiEngineService } from '../core/ai-engine.service';

@Injectable()
export class AiAutonomyPlannerService {
  constructor(private readonly engine: AiEngineService) {}

  async plan(input: AiSelfTriggerPlanDto): Promise<AiSelfTriggerPlanResult> {
    const result = await this.engine.structured<AiSelfTriggerPlanResult>({
      purpose: 'autonomy.trigger_plan',
      systemPrompt: [
        'You are Orchestrate autonomy planner.',
        'Design self-triggering, self-correcting, and self-improving AI behavior without executing actions.',
        'Respect the mode hierarchy: observe, suggest, auto_correct, block_and_escalate.',
        'Dead-important safety blockers may be block_and_escalate. Everything else should begin observe or suggest.',
      ].join('\n'),
      input,
      schema: this.schema(),
      modelTier: 'reasoning',
      retries: 1,
      metadata: { trustLayer: 'autonomy_planning', scope: input.scope },
    });
    return result.output;
  }

  private schema() {
    return {
      name: 'orchestrate_ai_self_trigger_plan',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string' },
          triggers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                condition: { type: 'string' },
                action: { type: 'string' },
                priority: { type: 'string' },
                mode: { type: 'string' },
                cooldownMinutes: { type: 'number' },
                evidenceRequired: { type: 'array', items: { type: 'string' } },
              },
              required: ['name', 'condition', 'action', 'priority', 'mode', 'cooldownMinutes', 'evidenceRequired'],
            },
          },
          selfCorrectionRules: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                detects: { type: 'string' },
                correction: { type: 'string' },
                requiresHumanReview: { type: 'boolean' },
              },
              required: ['name', 'detects', 'correction', 'requiresHumanReview'],
            },
          },
          selfImprovementSignals: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                signal: { type: 'string' },
                whyItMatters: { type: 'string' },
                suggestedMetric: { type: 'string' },
              },
              required: ['signal', 'whyItMatters', 'suggestedMetric'],
            },
          },
          risks: { type: 'array', items: { type: 'string' } },
        },
        required: ['scope', 'triggers', 'selfCorrectionRules', 'selfImprovementSignals', 'risks'],
      },
    };
  }
}
