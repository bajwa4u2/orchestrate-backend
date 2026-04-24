import { Injectable } from '@nestjs/common';
import { AiRealitySnapshotService } from '../authority/ai-reality-snapshot.service';
import { AiSystemDoctorDto } from '../contracts/ai-authority.contract';
import { AiEngineService } from '../core/ai-engine.service';

export interface AiSystemDiagnosis {
  rootCause: string;
  affectedLayer: 'frontend' | 'backend' | 'database' | 'provider' | 'email' | 'billing' | 'deployment' | 'unknown';
  confidence: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  proof: string[];
  likelyFiles: string[];
  safeFixPlan: string[];
  doNotTouch: string[];
  rollbackPlan: string[];
  validationPlan: string[];
  openQuestions: string[];
  aiMeta?: Record<string, unknown>;
}

@Injectable()
export class AiSystemDoctorService {
  constructor(
    private readonly ai: AiEngineService,
    private readonly snapshots: AiRealitySnapshotService,
  ) {}

  async diagnose(input: AiSystemDoctorDto) {
    const snapshot = input.entity && input.scope ? await this.snapshots.build({ scope: input.scope, entity: input.entity }) : null;
    const longContext = this.ai.prepareLongContext({
      sourceType: 'mixed',
      label: 'system-doctor',
      text: JSON.stringify(
        {
          issue: input.issue,
          expectedBehavior: input.expectedBehavior ?? null,
          observedBehavior: input.observedBehavior ?? null,
          logs: input.logs ?? [],
          harSummary: input.harSummary ?? null,
          apiResponses: input.apiResponses ?? null,
          dbState: input.dbState ?? null,
          files: input.files ?? [],
          snapshot,
        },
        null,
        2,
      ),
    });

    const result = await this.ai.structured<AiSystemDiagnosis>({
      purpose: 'intelligence.system_doctor',
      modelTier: 'long_context',
      systemPrompt: this.systemPrompt(),
      input: {
        task: 'Diagnose an Orchestrate system issue and propose a safe fix strategy.',
        boundary: {
          doNotInventFiles: true,
          doNotOverwriteWorkingBehavior: true,
          noPatchFragments: true,
          preferWholeReplacementFiles: true,
          databaseIsReality: true,
          preserveBackendContracts: true,
        },
        input,
        snapshot,
        longContext,
      },
      schema: {
        name: 'orchestrate_system_diagnosis',
        strict: true,
        schema: this.diagnosisSchema(),
      },
      retries: 1,
      metadata: {
        scope: input.scope ?? 'SYSTEM',
        entity: input.entity ?? {},
      },
    });

    return {
      ok: true,
      diagnosis: {
        ...this.normalizeDiagnosis(result.output),
        aiMeta: {
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          warnings: result.warnings,
        },
      },
      snapshot,
      longContext,
    };
  }

  private systemPrompt() {
    return [
      'You are Orchestrate AI System Doctor.',
      'You diagnose backend, frontend, DB, provider, email, billing, deployment, and contract-drift issues.',
      'Use only supplied logs, HAR summaries, API responses, DB state, file excerpts, and optional snapshots.',
      'Do not guess beyond evidence. Mark uncertainty clearly.',
      'The user prefers full replacement files, not stitched patches. Your plan must respect that.',
      'Return strict JSON matching the supplied schema. No markdown.',
    ].join('\n');
  }

  private diagnosisSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'rootCause',
        'affectedLayer',
        'confidence',
        'severity',
        'proof',
        'likelyFiles',
        'safeFixPlan',
        'doNotTouch',
        'rollbackPlan',
        'validationPlan',
        'openQuestions',
      ],
      properties: {
        rootCause: { type: 'string' },
        affectedLayer: { type: 'string', enum: ['frontend', 'backend', 'database', 'provider', 'email', 'billing', 'deployment', 'unknown'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        proof: { type: 'array', items: { type: 'string' } },
        likelyFiles: { type: 'array', items: { type: 'string' } },
        safeFixPlan: { type: 'array', items: { type: 'string' } },
        doNotTouch: { type: 'array', items: { type: 'string' } },
        rollbackPlan: { type: 'array', items: { type: 'string' } },
        validationPlan: { type: 'array', items: { type: 'string' } },
        openQuestions: { type: 'array', items: { type: 'string' } },
      },
    };
  }

  private normalizeDiagnosis(value: Partial<AiSystemDiagnosis>): AiSystemDiagnosis {
    return {
      rootCause: this.text(value.rootCause, 'Root cause is not determined from the supplied evidence.'),
      affectedLayer: this.layer(value.affectedLayer),
      confidence: this.confidence(value.confidence),
      severity: this.severity(value.severity),
      proof: this.list(value.proof),
      likelyFiles: this.list(value.likelyFiles),
      safeFixPlan: this.list(value.safeFixPlan),
      doNotTouch: this.list(value.doNotTouch),
      rollbackPlan: this.list(value.rollbackPlan),
      validationPlan: this.list(value.validationPlan),
      openQuestions: this.list(value.openQuestions),
    };
  }

  private text(value: unknown, fallback: string) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private list(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];
  }

  private confidence(value: unknown) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
  }

  private severity(value: unknown): AiSystemDiagnosis['severity'] {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ['low', 'medium', 'high', 'critical'].includes(text) ? (text as AiSystemDiagnosis['severity']) : 'medium';
  }

  private layer(value: unknown): AiSystemDiagnosis['affectedLayer'] {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ['frontend', 'backend', 'database', 'provider', 'email', 'billing', 'deployment', 'unknown'].includes(text)
      ? (text as AiSystemDiagnosis['affectedLayer'])
      : 'unknown';
  }
}
