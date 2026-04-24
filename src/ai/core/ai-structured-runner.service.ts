import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiEngineRequest, AiEngineResult } from '../contracts/ai-core.contract';
import { AiProviderRegistry } from '../providers/ai-provider.registry';
import { AiModelRouterService } from './ai-model-router.service';
import { AiUsageTrackerService } from './ai-usage-tracker.service';
import { AiCostPolicyService } from './ai-cost-policy.service';
import { AiConfidenceGateService } from './ai-confidence-gate.service';
import { AiOutputValidatorService } from './ai-output-validator.service';
import { AiTrustStoreService } from '../trust/ai-trust-store.service';

@Injectable()
export class AiStructuredRunnerService {
  constructor(
    private readonly providers: AiProviderRegistry,
    private readonly router: AiModelRouterService,
    private readonly usage: AiUsageTrackerService,
    private readonly costPolicy: AiCostPolicyService,
    private readonly confidenceGate: AiConfidenceGateService,
    private readonly validator: AiOutputValidatorService,
    private readonly store: AiTrustStoreService,
  ) {}

  async run<T = unknown>(request: AiEngineRequest<T>): Promise<AiEngineResult<T>> {
    const routed = this.router.route(request);
    const policy = this.costPolicy.assertAllowed(request, this.estimatePromptTokens(request));
    if (!policy.allowed) {
      throw new ServiceUnavailableException(policy.reason || 'AI call blocked by cost/input policy.');
    }

    const providers = this.providers.getCandidatesForCapability(request.capability, request.provider);
    const attempts = Math.max(1, (request.retries ?? 1) + 1);
    const warnings: string[] = [];
    let lastError: unknown;

    for (const provider of providers) {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const result = await provider.run<T>({
            ...request,
            model: request.model ?? routed.model,
            modelTier: routed.modelTier,
            userPrompt: this.composeUserPrompt(request, warnings),
          });

          const validation = this.validator.validate(result.output, request.schema);
          if (!validation.valid) {
            warnings.push(`AI output schema validation failed: ${validation.issues.join('; ')}`);
            if (request.allowRepair !== false && attempt < attempts) {
              warnings.push('Retrying with schema repair instruction.');
              continue;
            }
            if (request.fallback !== undefined) return this.fallbackResult(request, provider.name, routed.model, warnings);
            throw new Error(`AI output failed schema validation: ${validation.issues.join('; ')}`);
          }

          const gate = this.confidenceGate.evaluate(result);
          result.warnings.push(...warnings, ...gate.reasons.map((reason) => `trust_gate: ${reason}`));
          result.raw = { providerRaw: result.raw, trustGate: gate };

          this.usage.record(result);
          await this.store.recordUsage(result.usage, request.entity ?? {});
          return result;
        } catch (error) {
          lastError = error;
          warnings.push(`AI attempt ${attempt} via ${provider.name} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (request.fallback !== undefined) {
      const provider = providers[0] ?? this.providers.getForCapability(request.capability, request.provider);
      return this.fallbackResult(request, provider.name, routed.model, warnings);
    }

    throw new ServiceUnavailableException(
      `AI structured run failed after ${providers.length} provider(s) and ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private fallbackResult<T>(request: AiEngineRequest<T>, providerName: string, model?: string, warnings: string[] = []): AiEngineResult<T> {
    return {
      ok: false,
      provider: providerName,
      model: request.model ?? model ?? 'unknown',
      purpose: request.purpose,
      capability: request.capability,
      output: request.fallback as T,
      usage: {
        provider: providerName,
        model: request.model ?? model ?? 'unknown',
        purpose: request.purpose,
        capability: request.capability,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: null,
        latencyMs: 0,
      },
      confidence: 0,
      warnings,
    };
  }

  private composeUserPrompt(request: AiEngineRequest, warnings: string[]) {
    const base = request.userPrompt || JSON.stringify(
      {
        purpose: request.purpose,
        capability: request.capability,
        scope: request.scope ?? null,
        entity: request.entity ?? null,
        input: request.input ?? null,
        metadata: request.metadata ?? null,
      },
      null,
      2,
    );

    if (!warnings.some((warning) => warning.includes('schema validation failed'))) return base;

    return [
      base,
      '',
      'IMPORTANT REPAIR INSTRUCTION:',
      'Your previous response failed strict schema validation. Return only valid JSON matching the provided schema. Do not include prose, markdown, comments, or fields not allowed by schema.',
      `Validation problems: ${warnings.filter((w) => w.includes('schema validation failed')).slice(-1)[0]}`,
    ].join('\n');
  }

  private estimatePromptTokens(request: AiEngineRequest) {
    const text = [request.systemPrompt, request.userPrompt, JSON.stringify(request.input ?? {}), JSON.stringify(request.metadata ?? {})].join('\n');
    return Math.ceil(text.length / 4);
  }
}
