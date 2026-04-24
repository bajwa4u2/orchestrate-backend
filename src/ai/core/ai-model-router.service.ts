import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiEngineRequest, AiModelTier, AiPurpose } from '../contracts/ai-core.contract';

@Injectable()
export class AiModelRouterService {
  constructor(private readonly configService: ConfigService) {}

  route(input: Pick<AiEngineRequest, 'purpose' | 'capability' | 'model' | 'modelTier'>): { model?: string; modelTier: AiModelTier } {
    if (input.model) return { model: input.model, modelTier: input.modelTier ?? 'balanced' };

    const tier = input.modelTier ?? this.defaultTier(input.purpose);
    return {
      model: this.modelFromConfig(tier),
      modelTier: tier,
    };
  }

  private defaultTier(purpose: AiPurpose): AiModelTier {
    switch (purpose) {
      case 'authority.decision':
        return 'reasoning';
      case 'intelligence.system_doctor':
        return 'long_context';
      case 'governance.code_upgrade':
        return 'code';
      case 'governance.design_review':
        return 'reasoning';
      case 'analysis.long_context':
        return 'long_context';
      case 'evaluation.trust':
      case 'evaluation.judge':
      case 'autonomy.trigger_plan':
      case 'autonomy.self_correction':
      case 'autonomy.self_improvement':
        return 'reasoning';
      case 'classification.reply':
      case 'classification.intake':
      case 'generation.leads':
      case 'generation.sequence':
        return 'fast';
      case 'moderation.safety':
        return 'moderation';
      case 'embedding.semantic':
        return 'embedding';
      case 'speech.transcription':
      case 'speech.synthesis':
        return 'speech';
      case 'realtime.session':
        return 'realtime';
      case 'generation.strategy':
      case 'generation.message':
      case 'generation.revenue_draft':
      default:
        return 'balanced';
    }
  }

  private modelFromConfig(tier: AiModelTier) {
    const map: Record<AiModelTier, string | undefined> = {
      fast: this.configService.get<string>('OPENAI_MODEL_FAST'),
      balanced: this.configService.get<string>('OPENAI_MODEL_PRIMARY'),
      reasoning: this.configService.get<string>('OPENAI_MODEL_REASONING') || this.configService.get<string>('OPENAI_MODEL_PRIMARY'),
      code: this.configService.get<string>('OPENAI_MODEL_CODE') || this.configService.get<string>('OPENAI_MODEL_REASONING'),
      long_context: this.configService.get<string>('OPENAI_MODEL_LONG_CONTEXT') || this.configService.get<string>('OPENAI_MODEL_REASONING'),
      realtime: this.configService.get<string>('OPENAI_MODEL_REALTIME'),
      embedding: this.configService.get<string>('OPENAI_MODEL_EMBEDDING'),
      moderation: this.configService.get<string>('OPENAI_MODEL_MODERATION'),
      speech: this.configService.get<string>('OPENAI_MODEL_STT'),
      vision: this.configService.get<string>('OPENAI_MODEL_VISION') || this.configService.get<string>('OPENAI_MODEL_PRIMARY'),
    };
    return map[tier];
  }
}
