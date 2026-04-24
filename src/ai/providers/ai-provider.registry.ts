import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCapability, AiProviderName } from '../contracts/ai-core.contract';
import { AiProvider } from './ai-provider.interface';
import { OpenAiProvider } from './openai.provider';

@Injectable()
export class AiProviderRegistry {
  private readonly logger = new Logger(AiProviderRegistry.name);
  private readonly providers = new Map<AiProviderName, AiProvider>();

  constructor(
    private readonly configService: ConfigService,
    openAiProvider: OpenAiProvider,
  ) {
    this.register(openAiProvider);
  }

  register(provider: AiProvider) {
    if (!provider?.name) return;
    this.providers.set(provider.name, provider);
    this.logger.log(`Registered AI provider: ${provider.name}`);
  }

  list() {
    return Array.from(this.providers.values()).map((provider) => provider.capabilities());
  }

  get(name?: AiProviderName | null) {
    const preferred = name || this.configService.get<string>('AI_PROVIDER_DEFAULT') || 'openai';
    const provider = this.providers.get(preferred);
    if (provider) return provider;

    const fallback = this.providers.get('openai');
    if (fallback) return fallback;

    throw new ServiceUnavailableException(`AI provider is not available: ${preferred}`);
  }


  getCandidatesForCapability(capability: AiCapability, requestedProvider?: AiProviderName | null) {
    const ordered: AiProvider[] = [];
    if (requestedProvider) {
      const requested = this.providers.get(requestedProvider);
      if (requested) ordered.push(requested);
    }

    const preferred = this.configService.get<string>('AI_PROVIDER_DEFAULT') || 'openai';
    const preferredProvider = this.providers.get(preferred);
    if (preferredProvider && !ordered.includes(preferredProvider)) ordered.push(preferredProvider);

    for (const provider of this.providers.values()) {
      if (!ordered.includes(provider) && this.providerSupports(provider, capability)) ordered.push(provider);
    }

    const fallback = this.providers.get('openai');
    if (fallback && !ordered.includes(fallback)) ordered.push(fallback);

    return ordered.filter((provider) => this.providerSupports(provider, capability));
  }

  getForCapability(capability: AiCapability, requestedProvider?: AiProviderName | null) {
    if (requestedProvider) return this.get(requestedProvider);

    const preferred = this.configService.get<string>('AI_PROVIDER_DEFAULT') || 'openai';
    const provider = this.providers.get(preferred);
    if (provider && this.providerSupports(provider, capability)) return provider;

    const capable = Array.from(this.providers.values()).find((candidate) => this.providerSupports(candidate, capability));
    if (capable) return capable;

    return this.get(preferred);
  }

  private providerSupports(provider: AiProvider, capability: AiCapability) {
    const c = provider.capabilities();
    switch (capability) {
      case 'STRUCTURED_OUTPUT':
      case 'REVENUE_DECISION':
      case 'SYSTEM_DIAGNOSIS':
      case 'CODE_GOVERNANCE':
      case 'DESIGN_GOVERNANCE':
      case 'CLASSIFICATION':
      case 'LONG_CONTEXT_REASONING':
      case 'FILE_REASONING':
      case 'TOOL_PLANNING':
      case 'EVALUATION':
      case 'SELF_CORRECTION':
      case 'SELF_IMPROVEMENT':
      case 'AUTONOMY_PLANNING':
        return c.supportsStructuredOutput;
      case 'EMBEDDING':
        return c.supportsEmbeddings;
      case 'MODERATION':
        return c.supportsModeration;
      case 'SPEECH_TO_TEXT':
        return c.supportsSpeechToText;
      case 'TEXT_TO_SPEECH':
        return c.supportsTextToSpeech;
      case 'REALTIME_SESSION':
        return c.supportsRealtime;
      case 'IMAGE_UNDERSTANDING':
        return c.supportsVision;
      case 'TEXT_GENERATION':
      default:
        return true;
    }
  }
}
