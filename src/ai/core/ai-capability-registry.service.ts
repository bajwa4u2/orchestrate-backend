import { Injectable } from '@nestjs/common';
import { AiCapability, AiPurpose } from '../contracts/ai-core.contract';

@Injectable()
export class AiCapabilityRegistryService {
  capabilitiesForPurpose(purpose: AiPurpose): AiCapability[] {
    switch (purpose) {
      case 'authority.decision':
        return ['REVENUE_DECISION', 'STRUCTURED_OUTPUT', 'TOOL_PLANNING'];
      case 'intelligence.system_doctor':
        return ['SYSTEM_DIAGNOSIS', 'LONG_CONTEXT_REASONING', 'STRUCTURED_OUTPUT'];
      case 'governance.code_upgrade':
        return ['CODE_GOVERNANCE', 'LONG_CONTEXT_REASONING', 'STRUCTURED_OUTPUT'];
      case 'governance.design_review':
        return ['DESIGN_GOVERNANCE', 'STRUCTURED_OUTPUT'];
      case 'classification.reply':
      case 'classification.intake':
        return ['CLASSIFICATION', 'STRUCTURED_OUTPUT'];
      case 'analysis.long_context':
        return ['LONG_CONTEXT_REASONING', 'STRUCTURED_OUTPUT'];
      case 'evaluation.trust':
      case 'evaluation.judge':
        return ['EVALUATION', 'STRUCTURED_OUTPUT', 'LONG_CONTEXT_REASONING'];
      case 'autonomy.trigger_plan':
        return ['AUTONOMY_PLANNING', 'STRUCTURED_OUTPUT', 'LONG_CONTEXT_REASONING'];
      case 'autonomy.self_correction':
        return ['SELF_CORRECTION', 'STRUCTURED_OUTPUT'];
      case 'autonomy.self_improvement':
        return ['SELF_IMPROVEMENT', 'STRUCTURED_OUTPUT', 'LONG_CONTEXT_REASONING'];
      case 'moderation.safety':
        return ['MODERATION'];
      case 'embedding.semantic':
        return ['EMBEDDING'];
      case 'speech.transcription':
        return ['SPEECH_TO_TEXT'];
      case 'speech.synthesis':
        return ['TEXT_TO_SPEECH'];
      case 'realtime.session':
        return ['REALTIME_SESSION'];
      default:
        return ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'];
    }
  }

  primaryCapabilityForPurpose(purpose: AiPurpose): AiCapability {
    return this.capabilitiesForPurpose(purpose)[0];
  }
}
