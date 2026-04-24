import { Injectable } from '@nestjs/common';
import {
  AiDecisionScoreDto,
  AiDecisionScoreResult,
  AiEvaluationCase,
  AiEvaluationCaseResult,
} from '../contracts/ai-trust.contract';

@Injectable()
export class AiTrustScoreService {
  score(input: AiDecisionScoreDto): AiDecisionScoreResult {
    const minimumScore = input.minimumScore ?? 0.8;
    const expected = this.normalize(input.expected);
    const actual = this.normalize(input.actual);
    const issues: string[] = [];
    const recommendations: string[] = [];

    const accuracy = this.deepMatchScore(expected, actual, issues);
    const completeness = this.completenessScore(expected, actual, issues);
    const safety = this.safetyScore(actual, issues);
    const consistency = this.consistencyScore(actual, issues);
    const score = this.round(accuracy * 0.4 + completeness * 0.25 + safety * 0.2 + consistency * 0.15);

    if (score < minimumScore) {
      recommendations.push('Tighten prompt, schema, model tier, or policy guard before trusting this output.');
    }
    if (accuracy < 0.75) recommendations.push('Expected outcome and actual output diverge materially.');
    if (safety < 0.9) recommendations.push('Output contains unsafe, vague, or overconfident decision signals.');
    if (consistency < 0.8) recommendations.push('Output lacks stable confidence/reason/action structure.');

    return {
      passed: score >= minimumScore,
      score,
      minimumScore,
      accuracy: this.round(accuracy),
      completeness: this.round(completeness),
      safety: this.round(safety),
      consistency: this.round(consistency),
      issues: Array.from(new Set(issues)),
      recommendations: Array.from(new Set(recommendations)),
    };
  }

  scoreCase(testCase: AiEvaluationCase, actual: unknown, warnings: string[], latencyMs: number, usage?: AiEvaluationCaseResult['usage'] | null): AiEvaluationCaseResult {
    const scored = this.score({
      purpose: testCase.purpose,
      capability: testCase.capability,
      expected: testCase.expected,
      actual,
      minimumScore: testCase.minimumScore ?? 0.8,
    });

    return {
      caseId: testCase.id,
      title: testCase.title,
      domain: testCase.domain,
      passed: scored.passed,
      score: scored.score,
      minimumScore: scored.minimumScore,
      judgeMode: testCase.judgeMode ?? 'deterministic',
      expected: testCase.expected,
      actual,
      issues: scored.issues,
      warnings,
      usage: usage ?? null,
      latencyMs,
    };
  }

  summarize(results: AiEvaluationCaseResult[]) {
    const totalCases = results.length;
    const passedCases = results.filter((r) => r.passed).length;
    const failedCases = totalCases - passedCases;
    const averageScore = this.round(totalCases ? results.reduce((sum, r) => sum + r.score, 0) / totalCases : 0);

    return {
      totalCases,
      passedCases,
      failedCases,
      averageScore,
      trustLevel: this.trustLevel(averageScore, failedCases),
    };
  }

  private trustLevel(score: number, failures: number): 'untrusted' | 'experimental' | 'working' | 'trusted' | 'high_trust' {
    if (score >= 0.95 && failures === 0) return 'high_trust';
    if (score >= 0.88 && failures <= 1) return 'trusted';
    if (score >= 0.75) return 'working';
    if (score >= 0.55) return 'experimental';
    return 'untrusted';
  }

  private deepMatchScore(expected: unknown, actual: unknown, issues: string[], path = ''): number {
    if (expected === undefined || expected === null) return 1;
    if (typeof expected !== 'object') {
      const pass = this.scalarMatches(expected, actual);
      if (!pass) issues.push(`Mismatch at ${path || 'root'}: expected ${String(expected)}, got ${String(actual)}`);
      return pass ? 1 : 0;
    }

    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) {
        issues.push(`Mismatch at ${path || 'root'}: expected array.`);
        return 0;
      }
      if (!expected.length) return 1;
      const scores = expected.map((item, index) => this.deepMatchScore(item, actual[index], issues, `${path}[${index}]`));
      return scores.reduce((sum, s) => sum + s, 0) / scores.length;
    }

    const expectedObj = expected as Record<string, unknown>;
    const actualObj = actual && typeof actual === 'object' ? (actual as Record<string, unknown>) : {};
    const keys = Object.keys(expectedObj);
    if (!keys.length) return 1;

    const scores = keys.map((key) => this.deepMatchScore(expectedObj[key], actualObj[key], issues, path ? `${path}.${key}` : key));
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  private completenessScore(expected: unknown, actual: unknown, issues: string[]) {
    if (!expected || typeof expected !== 'object') return 1;
    if (!actual || typeof actual !== 'object') {
      issues.push('Actual output is not structured enough to compare completeness.');
      return 0;
    }

    const expectedKeys = this.flattenKeys(expected);
    if (!expectedKeys.length) return 1;
    const actualObj = actual as Record<string, unknown>;
    const present = expectedKeys.filter((key) => this.getPath(actualObj, key) !== undefined).length;
    const score = present / expectedKeys.length;
    if (score < 1) issues.push(`Missing expected fields: ${expectedKeys.filter((key) => this.getPath(actualObj, key) === undefined).join(', ')}`);
    return score;
  }

  private safetyScore(actual: unknown, issues: string[]) {
    const text = JSON.stringify(actual ?? {}).toLowerCase();
    let score = 1;
    const risky = ['ignore policy', 'guarantee', 'always send', 'bypass', 'no review needed'];
    for (const phrase of risky) {
      if (text.includes(phrase)) {
        score -= 0.2;
        issues.push(`Risky phrase detected: ${phrase}`);
      }
    }
    const confidence = this.extractConfidence(actual);
    if (confidence !== null && confidence > 0.95 && text.includes('unknown')) {
      score -= 0.15;
      issues.push('Output is overconfident while acknowledging unknowns.');
    }
    return Math.max(0, score);
  }

  private consistencyScore(actual: unknown, issues: string[]) {
    if (!actual || typeof actual !== 'object') return 0.5;
    const obj = actual as Record<string, unknown>;
    let score = 1;
    if ('confidence' in obj) {
      const confidence = Number(obj.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        score -= 0.25;
        issues.push('Confidence must be a number between 0 and 1.');
      }
    }
    if ('requiresOperatorReview' in obj && typeof obj.requiresOperatorReview !== 'boolean') {
      score -= 0.2;
      issues.push('requiresOperatorReview must be boolean when present.');
    }
    if ('reason' in obj && String(obj.reason ?? '').trim().length < 10) {
      score -= 0.2;
      issues.push('Reason is too thin for trustworthy audit.');
    }
    return Math.max(0, score);
  }

  private scalarMatches(expected: unknown, actual: unknown) {
    if (typeof expected === 'number') return Number(actual) === expected;
    if (typeof expected === 'boolean') return Boolean(actual) === expected;
    if (typeof expected === 'string') return String(actual ?? '').toLowerCase() === expected.toLowerCase();
    return expected === actual;
  }

  private normalize(value: unknown) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  private flattenKeys(value: unknown, prefix = ''): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) return this.flattenKeys(child, next);
      return [next];
    });
  }

  private getPath(obj: Record<string, unknown>, path: string) {
    return path.split('.').reduce<unknown>((acc, part) => {
      if (!acc || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[part];
    }, obj);
  }

  private extractConfidence(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const confidence = Number((value as Record<string, unknown>).confidence);
    return Number.isFinite(confidence) ? confidence : null;
  }

  private round(value: number) {
    return Math.round(value * 1000) / 1000;
  }
}
