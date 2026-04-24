import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AiEvaluationCaseResult,
  AiEvaluationRunDto,
  AiEvaluationRunResult,
} from '../contracts/ai-trust.contract';
import { AiEngineService } from '../core/ai-engine.service';
import { AiEvaluationCasesService } from './ai-evaluation-cases.service';
import { AiTrustScoreService } from './ai-trust-score.service';
import { AiTrustStoreService } from './ai-trust-store.service';

@Injectable()
export class AiEvaluatorService {
  private readonly recentRuns: AiEvaluationRunResult[] = [];

  constructor(
    private readonly cases: AiEvaluationCasesService,
    private readonly engine: AiEngineService,
    private readonly scoring: AiTrustScoreService,
    private readonly store: AiTrustStoreService,
  ) {}

  listEvaluationSets() {
    return this.cases.listSets();
  }

  recentSummary() {
    const latest = this.recentRuns[this.recentRuns.length - 1] ?? null;
    return {
      runCount: this.recentRuns.length,
      latestRunId: latest?.runId ?? null,
      latestTrustLevel: latest?.trustLevel ?? null,
      latestAverageScore: latest?.averageScore ?? null,
    };
  }

  async run(input: AiEvaluationRunDto): Promise<AiEvaluationRunResult> {
    const startedAt = new Date().toISOString();
    const selected = this.cases.select({
      setId: input.setId,
      caseIds: input.caseIds,
      domains: input.domains,
      maxCases: input.maxCases,
    });

    const results: AiEvaluationCaseResult[] = [];
    for (const testCase of selected) {
      const start = Date.now();
      if (input.dryRun) {
        results.push(this.scoring.scoreCase(testCase, testCase.expected, ['Dry run used expected output as actual output.'], Date.now() - start));
        continue;
      }

      try {
        const result = await this.engine.structured({
          purpose: testCase.purpose,
          systemPrompt: testCase.systemPrompt,
          input: {
            description: testCase.description,
            input: testCase.input,
            expectedShape: testCase.expected,
            instruction: 'Return the best operational answer for this evaluation case. Follow the schema exactly.',
          },
          schema: testCase.schema ?? this.fallbackSchema(),
          modelTier: testCase.modelTier,
          retries: 1,
          metadata: {
            evaluationCaseId: testCase.id,
            evaluationSetId: input.setId ?? 'mixed',
            judgeMode: input.judgeMode ?? testCase.judgeMode ?? 'deterministic',
          },
        });
        results.push(this.scoring.scoreCase(testCase, result.output, result.warnings, Date.now() - start, result.usage));
      } catch (error) {
        results.push({
          caseId: testCase.id,
          title: testCase.title,
          domain: testCase.domain,
          passed: false,
          score: 0,
          minimumScore: testCase.minimumScore ?? 0.8,
          judgeMode: input.judgeMode ?? testCase.judgeMode ?? 'deterministic',
          expected: testCase.expected,
          actual: null,
          issues: [`Evaluation call failed: ${error instanceof Error ? error.message : String(error)}`],
          warnings: [],
          usage: null,
          latencyMs: Date.now() - start,
        });
      }
    }

    const summary = this.scoring.summarize(results);
    const completedAt = new Date().toISOString();
    const run: AiEvaluationRunResult = {
      ok: summary.failedCases === 0,
      runId: randomUUID(),
      startedAt,
      completedAt,
      setIds: input.setId ? [input.setId] : this.cases.setIdsForCases(results.map((r) => r.caseId)),
      totalCases: summary.totalCases,
      passedCases: summary.passedCases,
      failedCases: summary.failedCases,
      averageScore: summary.averageScore,
      trustLevel: summary.trustLevel,
      results,
      recommendations: this.recommend(results, summary.averageScore),
    };

    this.recentRuns.push(run);
    if (this.recentRuns.length > 100) this.recentRuns.shift();
    await this.store.recordEvaluation(run);
    return run;
  }

  latestRun() {
    return this.recentRuns[this.recentRuns.length - 1] ?? null;
  }

  private recommend(results: AiEvaluationCaseResult[], averageScore: number) {
    const recommendations = new Set<string>();
    if (averageScore < 0.88) recommendations.add('Keep AI in observe/suggest mode for this capability until trust score improves.');
    for (const result of results.filter((r) => !r.passed)) {
      recommendations.add(`Improve ${result.domain}: ${result.title}`);
      for (const issue of result.issues.slice(0, 2)) recommendations.add(issue);
    }
    if (!recommendations.size) recommendations.add('Trust baseline passed. Continue expanding evaluation coverage before runtime wiring.');
    return Array.from(recommendations);
  }

  private fallbackSchema() {
    return {
      name: 'orchestrate_generic_eval_output',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          decision: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['reason', 'confidence'],
      },
    };
  }
}
