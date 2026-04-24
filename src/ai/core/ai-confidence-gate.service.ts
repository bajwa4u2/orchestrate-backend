import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiEngineResult, AiPurpose } from '../contracts/ai-core.contract';

export interface AiConfidenceGateResult {
  allowedForAutomation: boolean;
  requiresHumanReview: boolean;
  trustMode: 'blocked' | 'observe' | 'suggest' | 'trusted';
  threshold: number;
  confidence: number | null;
  reasons: string[];
}

@Injectable()
export class AiConfidenceGateService {
  constructor(private readonly configService: ConfigService) {}

  evaluate(result: Pick<AiEngineResult, 'purpose' | 'confidence' | 'warnings' | 'ok'>): AiConfidenceGateResult {
    const threshold = this.thresholdFor(result.purpose);
    const confidence = typeof result.confidence === 'number' ? result.confidence : null;
    const reasons: string[] = [];

    if (!result.ok) reasons.push('AI call did not complete successfully.');
    if (confidence === null) reasons.push('AI output did not include measurable confidence.');
    if (confidence !== null && confidence < threshold) reasons.push(`Confidence ${confidence} below threshold ${threshold}.`);
    if (result.warnings?.length) reasons.push(...result.warnings.slice(0, 3));

    const forceObserve = this.csv(this.configService.get<string>('AI_FORCE_OBSERVE_PURPOSES')).includes(result.purpose);
    const forceBlocked = this.csv(this.configService.get<string>('AI_BLOCKED_PURPOSES')).includes(result.purpose);

    if (forceBlocked) {
      return { allowedForAutomation: false, requiresHumanReview: true, trustMode: 'blocked', threshold, confidence, reasons: ['Purpose blocked by trust policy.', ...reasons] };
    }

    if (forceObserve) {
      return { allowedForAutomation: false, requiresHumanReview: true, trustMode: 'observe', threshold, confidence, reasons: ['Purpose forced into observe mode.', ...reasons] };
    }

    const trusted = result.ok && confidence !== null && confidence >= threshold && !result.warnings?.some((w) => w.toLowerCase().includes('failed'));
    return {
      allowedForAutomation: trusted,
      requiresHumanReview: !trusted,
      trustMode: trusted ? 'trusted' : 'suggest',
      threshold,
      confidence,
      reasons,
    };
  }

  thresholdFor(purpose: AiPurpose) {
    const specific = Number(this.configService.get<string>(`AI_CONFIDENCE_${purpose.toUpperCase().replace(/\W/g, '_')}`) || 0);
    if (specific > 0) return specific;

    switch (purpose) {
      case 'authority.decision':
        return Number(this.configService.get<string>('AI_CONFIDENCE_AUTHORITY') || 0.86);
      case 'intelligence.system_doctor':
      case 'governance.code_upgrade':
      case 'governance.design_review':
        return Number(this.configService.get<string>('AI_CONFIDENCE_GOVERNANCE') || 0.82);
      case 'classification.reply':
      case 'classification.intake':
        return Number(this.configService.get<string>('AI_CONFIDENCE_CLASSIFICATION') || 0.8);
      default:
        return Number(this.configService.get<string>('AI_CONFIDENCE_DEFAULT') || 0.78);
    }
  }

  private csv(value?: string | null) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
