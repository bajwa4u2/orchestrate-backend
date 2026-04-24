import { Injectable } from '@nestjs/common';
import { AiCapabilityRegistryService } from './ai-capability-registry.service';
import { AiContextManagerService } from './ai-context-manager.service';
import { AiLongContextService } from './ai-long-context.service';
import { AiStructuredRunnerService } from './ai-structured-runner.service';
import { AiEngineRequest, AiEngineResult, AiJsonSchema } from '../contracts/ai-core.contract';

@Injectable()
export class AiEngineService {
  constructor(
    private readonly runner: AiStructuredRunnerService,
    private readonly capabilities: AiCapabilityRegistryService,
    private readonly context: AiContextManagerService,
    private readonly longContext: AiLongContextService,
  ) {}

  run<T = unknown>(request: AiEngineRequest<T>): Promise<AiEngineResult<T>> {
    const capability = request.capability ?? this.capabilities.primaryCapabilityForPurpose(request.purpose);
    return this.runner.run<T>({ ...request, capability });
  }

  structured<T = unknown>(input: {
    purpose: AiEngineRequest['purpose'];
    systemPrompt: string;
    input?: unknown;
    userPrompt?: string;
    schema: AiJsonSchema;
    modelTier?: AiEngineRequest['modelTier'];
    metadata?: Record<string, unknown>;
    contextKey?: string;
    retries?: number;
  }) {
    return this.run<T>({
      purpose: input.purpose,
      capability: this.capabilities.primaryCapabilityForPurpose(input.purpose),
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      input: input.input,
      schema: input.schema,
      modelTier: input.modelTier,
      metadata: input.metadata,
      contextKey: input.contextKey,
      retries: input.retries ?? 1,
      allowRepair: true,
      expect: 'json',
    });
  }

  text(input: {
    purpose: AiEngineRequest['purpose'];
    systemPrompt: string;
    userPrompt?: string;
    input?: unknown;
    modelTier?: AiEngineRequest['modelTier'];
    metadata?: Record<string, unknown>;
  }) {
    return this.run<string>({
      purpose: input.purpose,
      capability: 'TEXT_GENERATION',
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      input: input.input,
      modelTier: input.modelTier,
      metadata: input.metadata,
      expect: 'text',
    });
  }

  remember(key: string, turn: Parameters<AiContextManagerService['append']>[1]) {
    return this.context.append(key, turn);
  }

  getContext(key: string) {
    return this.context.get(key);
  }

  prepareLongContext(input: Parameters<AiLongContextService['chunk']>[0]) {
    return this.longContext.chunk(input);
  }
}
