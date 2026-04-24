import { Injectable } from '@nestjs/common';
import { AiLongContextChunk, AiLongContextSummary } from '../contracts/ai-core.contract';

@Injectable()
export class AiLongContextService {
  chunk(input: {
    sourceType?: AiLongContextSummary['sourceType'];
    label?: string;
    text: string;
    maxChars?: number;
    metadata?: Record<string, unknown>;
  }): AiLongContextSummary {
    const maxChars = Math.max(2000, input.maxChars ?? 12000);
    const chunks: AiLongContextChunk[] = [];
    const text = input.text || '';

    for (let start = 0, index = 0; start < text.length; start += maxChars, index += 1) {
      const slice = text.slice(start, start + maxChars);
      chunks.push({
        index,
        label: `${input.label ?? 'context'}-${index + 1}`,
        text: slice,
        tokenEstimate: this.estimateTokens(slice),
        metadata: input.metadata,
      });
    }

    return {
      sourceType: input.sourceType ?? 'unknown',
      chunkCount: chunks.length,
      totalTokenEstimate: chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
      executiveSummary: this.roughSummary(text),
      keyFindings: this.extractSignalLines(text),
      risks: this.extractRiskLines(text),
      suggestedNextQuestions: [
        'Which backend truth source is contradicted by the observed behavior?',
        'Which file or service owns the failing contract?',
        'What should not be changed while fixing this?',
      ],
      chunks,
    };
  }

  buildMixedContext(parts: Array<{ label: string; text: string; metadata?: Record<string, unknown> }>) {
    return parts.map((part) => [`### ${part.label}`, part.text].join('\n')).join('\n\n');
  }

  estimateTokens(text: string) {
    return Math.ceil((text || '').length / 4);
  }

  private roughSummary(text: string) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'No context provided.';
    return clean.slice(0, 1000);
  }

  private extractSignalLines(text: string) {
    return (text || '')
      .split('\n')
      .filter((line) => /error|warn|failed|exception|blocked|mismatch|undefined|null|404|500|401|403/i.test(line))
      .slice(0, 20)
      .map((line) => line.trim().slice(0, 400));
  }

  private extractRiskLines(text: string) {
    return (text || '')
      .split('\n')
      .filter((line) => /send|billing|payment|agreement|unsubscribe|suppression|duplicate|migration|provider|secret|token/i.test(line))
      .slice(0, 20)
      .map((line) => line.trim().slice(0, 400));
  }
}
