import { Injectable } from '@nestjs/common';
import { AiSelfCorrectionDto, AiSelfCorrectionResult } from '../contracts/ai-trust.contract';
import { AiEngineService } from '../core/ai-engine.service';
import { AiTrustScoreService } from './ai-trust-score.service';

@Injectable()
export class AiSelfCorrectionService {
  constructor(
    private readonly engine: AiEngineService,
    private readonly scoring: AiTrustScoreService,
  ) {}

  async correct<T = unknown>(input: AiSelfCorrectionDto): Promise<AiSelfCorrectionResult<T>> {
    const passes = Math.max(1, Math.min(3, input.maxCorrectionPasses ?? 2));
    let current = input.output;
    const warnings: string[] = [];
    const resolved: string[] = [];
    let remaining = input.issues ?? [];

    for (let index = 1; index <= passes; index += 1) {
      const score = this.scoring.score({
        purpose: input.purpose,
        capability: input.capability,
        expected: {},
        actual: current,
        minimumScore: 0.8,
      });

      if (!remaining.length && score.safety >= 0.9 && score.consistency >= 0.85) {
        return {
          corrected: index > 1,
          output: current as T,
          confidence: Math.min(1, Math.max(score.score, score.consistency)),
          passes: index - 1,
          issuesResolved: resolved,
          remainingIssues: [],
          warnings,
        };
      }

      try {
        const result = await this.engine.structured<T>({
          purpose: 'autonomy.self_correction',
          systemPrompt: [
            'You are Orchestrate AI self-correction layer.',
            'Correct the output without inventing facts.',
            'Preserve safe uncertainty. Escalate when evidence is insufficient.',
            'Return only schema-valid corrected output.',
          ].join('\n'),
          input: {
            originalSystemPrompt: input.systemPrompt,
            originalInput: input.input,
            currentOutput: current,
            detectedIssues: remaining,
            correctionPass: index,
          },
          schema: input.schema ?? this.genericCorrectionSchema(),
          modelTier: 'reasoning',
          retries: 1,
          metadata: { selfCorrectionPass: index, sourcePurpose: input.purpose },
        });
        current = result.output;
        resolved.push(...remaining);
        remaining = result.warnings.length ? result.warnings : [];
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(`Self-correction pass ${index} failed: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }

    const finalScore = this.scoring.score({
      purpose: input.purpose,
      capability: input.capability,
      expected: {},
      actual: current,
      minimumScore: 0.8,
    });

    return {
      corrected: resolved.length > 0,
      output: current as T,
      confidence: finalScore.score,
      passes,
      issuesResolved: Array.from(new Set(resolved)),
      remainingIssues: Array.from(new Set(remaining.length ? remaining : finalScore.issues)),
      warnings: Array.from(new Set(warnings)),
    };
  }

  private genericCorrectionSchema() {
    return {
      name: 'orchestrate_self_corrected_output',
      strict: false,
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['reason', 'confidence'],
      },
    };
  }
}
