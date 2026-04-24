import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  AiEngineRequest,
  AiEngineResult,
  AiProviderCapabilities,
  AiUsageRecord,
} from '../contracts/ai-core.contract';
import { AiProvider } from './ai-provider.interface';

export interface StructuredGenerationOptions {
  model?: string;
  temperature?: number;
  systemPrompt: string;
  userPrompt: string;
  schema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  retries?: number;
}

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI;
  private readonly primaryModel: string;
  private readonly fastModel: string;
  private readonly reasoningModel: string;
  private readonly codeModel: string;
  private readonly longContextModel: string;
  private readonly realtimeModel: string;
  private readonly embeddingModel: string;
  private readonly moderationModel: string;
  private readonly speechToTextModel: string;
  private readonly textToSpeechModel: string;
  private readonly useResponsesApi: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: this.configService.get<string>('OPENAI_BASE_URL') || undefined,
      timeout: Number(this.configService.get<string>('OPENAI_TIMEOUT_MS') || 60000),
    });

    this.primaryModel = this.configService.get<string>('OPENAI_MODEL_PRIMARY') || 'gpt-5.4';
    this.fastModel = this.configService.get<string>('OPENAI_MODEL_FAST') || 'gpt-5.4-mini';
    this.reasoningModel = this.configService.get<string>('OPENAI_MODEL_REASONING') || this.primaryModel;
    this.codeModel = this.configService.get<string>('OPENAI_MODEL_CODE') || this.reasoningModel;
    this.longContextModel = this.configService.get<string>('OPENAI_MODEL_LONG_CONTEXT') || this.reasoningModel;
    this.realtimeModel = this.configService.get<string>('OPENAI_MODEL_REALTIME') || 'gpt-realtime';
    this.embeddingModel = this.configService.get<string>('OPENAI_MODEL_EMBEDDING') || 'text-embedding-3-large';
    this.moderationModel = this.configService.get<string>('OPENAI_MODEL_MODERATION') || 'omni-moderation-latest';
    this.speechToTextModel = this.configService.get<string>('OPENAI_MODEL_STT') || 'gpt-4o-transcribe';
    this.textToSpeechModel = this.configService.get<string>('OPENAI_MODEL_TTS') || 'gpt-4o-mini-tts';
    this.useResponsesApi = this.configService.get<string>('OPENAI_USE_RESPONSES_API') !== 'false';
  }

  capabilities(): AiProviderCapabilities {
    return {
      provider: this.name,
      supportsStructuredOutput: true,
      supportsTools: true,
      supportsEmbeddings: true,
      supportsModeration: true,
      supportsSpeechToText: true,
      supportsTextToSpeech: true,
      supportsRealtime: true,
      supportsVision: true,
      supportsFiles: true,
      supportsReasoningEffort: true,
    };
  }

  getPrimaryModel() {
    return this.primaryModel;
  }

  getFastModel() {
    return this.fastModel;
  }

  getReasoningModel() {
    return this.reasoningModel;
  }

  getCodeModel() {
    return this.codeModel;
  }

  getLongContextModel() {
    return this.longContextModel;
  }

  getEmbeddingModel() {
    return this.embeddingModel;
  }

  async run<T = unknown>(request: AiEngineRequest<T>): Promise<AiEngineResult<T>> {
    const startedAt = Date.now();
    const model = request.model || this.modelForTier(request.modelTier);
    const warnings: string[] = [];

    try {
      const output = await this.executeWithBestAvailableApi<T>({ ...request, model }, warnings);
      const usage = this.normalizeUsage({
        provider: this.name,
        model,
        purpose: request.purpose,
        capability: request.capability,
        latencyMs: Date.now() - startedAt,
        rawUsage: output.rawUsage,
      });

      return {
        ok: true,
        provider: this.name,
        model,
        purpose: request.purpose,
        capability: request.capability,
        output: output.value,
        text: output.text ?? null,
        toolCalls: output.toolCalls ?? [],
        usage,
        confidence: this.extractConfidence(output.value),
        warnings,
        raw: output.raw,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`OpenAI request failed for ${request.purpose}: ${message}`);
      throw new ServiceUnavailableException(`OpenAI request failed: ${message}`);
    }
  }

  async generateStructured<T>(options: StructuredGenerationOptions): Promise<T> {
    const result = await this.run<T>({
      purpose: 'generation.message',
      capability: 'STRUCTURED_OUTPUT',
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      schema: options.schema,
      model: options.model,
      temperature: options.temperature ?? 0.2,
      retries: options.retries ?? 1,
      allowRepair: true,
      expect: 'json',
    });

    return result.output;
  }

  async generateText(options: {
    model?: string;
    temperature?: number;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string> {
    const result = await this.run<string>({
      purpose: 'generation.message',
      capability: 'TEXT_GENERATION',
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      model: options.model,
      temperature: options.temperature ?? 0.3,
      expect: 'text',
    });

    return result.text || String(result.output || '');
  }

  private async executeWithBestAvailableApi<T>(request: AiEngineRequest<T>, warnings: string[]) {
    const canUseResponses = this.useResponsesApi && Boolean((this.client as any).responses?.create);
    if (canUseResponses) {
      try {
        return await this.executeResponsesApi<T>(request);
      } catch (error) {
        warnings.push('Responses API failed; fell back to chat.completions compatibility path.');
        this.logger.warn(`Responses API fallback for ${request.purpose}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return this.executeChatCompletionsApi<T>(request);
  }

  private async executeResponsesApi<T>(request: AiEngineRequest<T>) {
    const textFormat = request.schema
      ? {
          format: {
            type: 'json_schema',
            name: request.schema.name,
            strict: request.schema.strict ?? true,
            schema: request.schema.schema,
          },
        }
      : undefined;

    const body: Record<string, unknown> = {
      model: request.model,
      input: this.composeInput(request),
      temperature: request.temperature ?? 0.2,
      max_output_tokens: request.maxOutputTokens,
      text: textFormat,
      tools: request.tools?.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.strict ?? true,
      })),
      metadata: this.stringMetadata(request.metadata),
    };

    if (this.isReasoningPurpose(request.purpose)) {
      body.reasoning = {
        effort: this.configService.get<string>('OPENAI_REASONING_EFFORT') || 'medium',
      };
    }

    const response = await (this.client as any).responses.create(this.cleanUndefined(body));
    const text = this.extractResponsesText(response);
    const value = request.expect === 'text' && !request.schema ? (text as T) : this.parseJsonText<T>(text);

    return {
      value,
      text,
      raw: response,
      rawUsage: response?.usage,
      toolCalls: this.extractResponsesToolCalls(response),
    };
  }

  private async executeChatCompletionsApi<T>(request: AiEngineRequest<T>) {
    const responseFormat = request.schema
      ? {
          type: 'json_schema',
          json_schema: {
            name: request.schema.name,
            strict: request.schema.strict ?? true,
            schema: request.schema.schema,
          },
        }
      : request.expect === 'json'
        ? { type: 'json_object' }
        : undefined;

    const completion = await this.client.chat.completions.create({
      model: request.model || this.primaryModel,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxOutputTokens,
      response_format: responseFormat as any,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt || JSON.stringify(request.input ?? {}, null, 2) },
      ],
      tools: request.tools?.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict ?? true,
        },
      })) as any,
    });

    const content = completion.choices[0]?.message?.content || '';
    const toolCalls = completion.choices[0]?.message?.tool_calls?.map((call: any) => ({
      name: call.function?.name || 'unknown_tool',
      arguments: this.safeParseObject(call.function?.arguments),
    })) ?? [];

    const value = request.expect === 'text' && !request.schema ? (content as T) : this.parseJsonText<T>(content);

    return {
      value,
      text: content,
      raw: completion,
      rawUsage: completion.usage,
      toolCalls,
    };
  }

  private composeInput(request: AiEngineRequest) {
    return [
      {
        role: 'system',
        content: [{ type: 'input_text', text: request.systemPrompt }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: request.userPrompt || JSON.stringify(request.input ?? {}, null, 2),
          },
        ],
      },
    ];
  }

  private parseJsonText<T>(text: string): T {
    if (!text?.trim()) throw new Error('AI provider returned empty output');

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      const extracted = this.extractJson(text);
      if (extracted) return JSON.parse(extracted) as T;
      throw error;
    }
  }

  private extractJson(text: string) {
    const trimmed = text.trim();
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1);

    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1);

    return null;
  }

  private extractResponsesText(response: any) {
    if (typeof response?.output_text === 'string') return response.output_text;

    const pieces: string[] = [];
    for (const item of response?.output ?? []) {
      for (const content of item?.content ?? []) {
        if (typeof content?.text === 'string') pieces.push(content.text);
      }
    }
    return pieces.join('\n').trim();
  }

  private extractResponsesToolCalls(response: any) {
    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    for (const item of response?.output ?? []) {
      if (item?.type === 'function_call') {
        calls.push({
          name: item.name || 'unknown_tool',
          arguments: this.safeParseObject(item.arguments),
        });
      }
    }
    return calls;
  }

  private safeParseObject(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'object') return value as Record<string, unknown>;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return { raw: value };
      }
    }
    return { raw: value };
  }

  private normalizeUsage(input: {
    provider: 'openai';
    model: string;
    purpose: AiUsageRecord['purpose'];
    capability: AiUsageRecord['capability'];
    latencyMs: number;
    rawUsage?: any;
  }): AiUsageRecord {
    const raw = input.rawUsage ?? {};
    const inputTokens = Number(raw.input_tokens ?? raw.prompt_tokens ?? 0);
    const outputTokens = Number(raw.output_tokens ?? raw.completion_tokens ?? 0);
    const totalTokens = Number(raw.total_tokens ?? inputTokens + outputTokens);

    return {
      provider: input.provider,
      model: input.model,
      purpose: input.purpose,
      capability: input.capability,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: this.estimateCost(input.model, inputTokens, outputTokens),
      latencyMs: input.latencyMs,
      cachedInputTokens: Number(raw.input_tokens_details?.cached_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0),
      reasoningTokens: Number(raw.output_tokens_details?.reasoning_tokens ?? raw.completion_tokens_details?.reasoning_tokens ?? 0),
      requestId: raw.id ?? null,
    };
  }

  private estimateCost(model: string, inputTokens: number, outputTokens: number) {
    const pricing = this.modelPricing(model);
    if (!pricing) return null;

    const cost = (inputTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion;
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  private modelPricing(model: string): { inputPerMillion: number; outputPerMillion: number } | null {
    const raw = this.configService.get<string>('OPENAI_MODEL_PRICING_JSON') || this.configService.get<string>('AI_MODEL_PRICING_JSON');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, { inputPerMillion?: number; outputPerMillion?: number }>;
        const exact = parsed[model];
        if (exact) {
          return {
            inputPerMillion: Number(exact.inputPerMillion ?? 0),
            outputPerMillion: Number(exact.outputPerMillion ?? 0),
          };
        }
        const lowered = model.toLowerCase();
        for (const [key, value] of Object.entries(parsed)) {
          if (lowered.includes(key.toLowerCase())) {
            return {
              inputPerMillion: Number(value.inputPerMillion ?? 0),
              outputPerMillion: Number(value.outputPerMillion ?? 0),
            };
          }
        }
      } catch {
        this.logger.warn('OPENAI_MODEL_PRICING_JSON is invalid; cost estimates disabled for this call.');
      }
    }

    const defaultInput = Number(this.configService.get<string>('AI_DEFAULT_INPUT_USD_PER_1M') || 0);
    const defaultOutput = Number(this.configService.get<string>('AI_DEFAULT_OUTPUT_USD_PER_1M') || 0);
    if (defaultInput > 0 || defaultOutput > 0) {
      return { inputPerMillion: defaultInput, outputPerMillion: defaultOutput };
    }

    return null;
  }

  private modelForTier(tier?: AiEngineRequest['modelTier']) {
    switch (tier) {
      case 'fast':
        return this.fastModel;
      case 'reasoning':
        return this.reasoningModel;
      case 'code':
        return this.codeModel;
      case 'long_context':
        return this.longContextModel;
      case 'realtime':
        return this.realtimeModel;
      case 'embedding':
        return this.embeddingModel;
      case 'moderation':
        return this.moderationModel;
      case 'speech':
        return this.speechToTextModel;
      case 'balanced':
      default:
        return this.primaryModel;
    }
  }

  private isReasoningPurpose(purpose: AiEngineRequest['purpose']) {
    return [
      'authority.decision',
      'intelligence.system_doctor',
      'governance.code_upgrade',
      'governance.design_review',
      'analysis.long_context',
      'evaluation.trust',
      'evaluation.judge',
      'autonomy.trigger_plan',
      'autonomy.self_correction',
      'autonomy.self_improvement',
    ].includes(purpose);
  }

  private extractConfidence(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const maybe = (value as { confidence?: unknown }).confidence;
    const number = typeof maybe === 'number' ? maybe : Number(maybe);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
  }

  private cleanUndefined(input: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  }

  private stringMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) return undefined;
    return Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
    );
  }
}
