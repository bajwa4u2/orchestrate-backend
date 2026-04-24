import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { AiEngineService } from '../core/ai-engine.service';
import {
  AiAuthorityAction,
  AiAuthorityDecision,
  AiAuthorityRequest,
  AiDecisionRisk,
} from '../contracts/ai-authority.contract';
import { AiRealitySnapshotService } from './ai-reality-snapshot.service';
import { AiDecisionPolicyService } from './ai-decision-policy.service';
import { AiDecisionRecorderService } from './ai-decision-recorder.service';

interface RawAuthorityResponse {
  action?: string;
  actor?: string;
  jobType?: string | null;
  allowedToProceed?: boolean;
  requiresHumanReview?: boolean;
  confidence?: number;
  risk?: string;
  reason?: string;
  evidence?: string[];
  blockers?: string[];
  nextActionAt?: string | null;
  recommendedQueueName?: string | null;
  recommendedDedupeKey?: string | null;
  notes?: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AiDecisionAuthorityService {
  private readonly logger = new Logger(AiDecisionAuthorityService.name);

  constructor(
    private readonly ai: AiEngineService,
    private readonly snapshots: AiRealitySnapshotService,
    private readonly policy: AiDecisionPolicyService,
    private readonly recorder: AiDecisionRecorderService,
  ) {}

  async decide(input: AiAuthorityRequest) {
    const snapshot = input.snapshot ?? (await this.snapshots.build({ scope: input.scope, entity: input.entity }));

    const aiResult = await this.ai.structured<RawAuthorityResponse>({
      purpose: 'authority.decision',
      modelTier: 'reasoning',
      systemPrompt: this.systemPrompt(),
      input: {
        task: 'Decide the next safest and most useful revenue-system action.',
        requestedScope: input.scope,
        preferredAction: input.preferredAction ?? null,
        proposedJobType: input.proposedJobType ?? null,
        question: input.question ?? null,
        operatorNote: input.operatorNote ?? null,
        decisionBoundary: {
          aiAuthority: 'Decide what should happen next.',
          databaseAuthority: 'Treat snapshot facts as reality. Do not invent facts.',
          backendAuthority: 'Hard policy may block or normalize your decision after you respond.',
          workersAuthority: 'Workers execute only after a decision is validated.',
        },
        allowedActions: this.allowedActions(),
        snapshot,
      },
      schema: {
        name: 'orchestrate_ai_authority_decision',
        strict: true,
        schema: this.decisionSchema(),
      },
      retries: 1,
      metadata: {
        scope: input.scope,
        entity: input.entity,
      },
    });

    const raw = aiResult.output;

    const decision = this.normalizeDecision(raw, input, snapshot.entity);
    const policy = this.policy.validate(decision, snapshot);

    const finalDecision: AiAuthorityDecision = {
      ...decision,
      action: policy.normalizedAction ?? decision.action,
      jobType: policy.normalizedJobType ?? decision.jobType ?? null,
      allowedToProceed: decision.allowedToProceed && policy.allowed,
      requiresHumanReview: Boolean(decision.requiresHumanReview || policy.requiresHumanReview),
      blockers: Array.from(new Set([...(decision.blockers ?? []), ...policy.blockers])),
      metadata: {
        ...(decision.metadata ?? {}),
        policy: policy.metadata,
        authorityVersion: '2026-04-ai-authority-v1',
        ai: { provider: aiResult.provider, model: aiResult.model, usage: aiResult.usage, warnings: aiResult.warnings },
      },
    };

    if (input.recordDecision !== false && !input.dryRun) {
      await this.recorder.record({ decision: finalDecision, snapshot, policy }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`AI decision recording failed: ${message}`);
      });
    }

    return {
      ok: true,
      decision: finalDecision,
      policy,
      snapshot,
    };
  }

  private systemPrompt() {
    return [
      'You are Orchestrate AI Decision Authority.',
      'You govern a DB-grounded revenue engine. You do not execute actions. You decide the next operational action and explain why.',
      'The database snapshot is the authority of reality. Never invent missing payment, agreement, email, campaign, reply, or meeting state.',
      'Prefer WAIT or REQUIRE_HUMAN_REVIEW when reality is incomplete, risky, contradictory, or legally/commercially sensitive.',
      'Use backend-safe decisions only. Do not instruct the system to bypass payment, consent, suppression, deliverability, agreement, or operator review safeguards.',
      'Return JSON only with these keys: action, actor, jobType, allowedToProceed, requiresHumanReview, confidence, risk, reason, evidence, blockers, nextActionAt, recommendedQueueName, recommendedDedupeKey, notes, metadata.',
      'Keep reason concise and operational. Evidence must cite snapshot facts, not guesses.',
    ].join('\n');
  }


  private decisionSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'action',
        'actor',
        'jobType',
        'allowedToProceed',
        'requiresHumanReview',
        'confidence',
        'risk',
        'reason',
        'evidence',
        'blockers',
        'nextActionAt',
        'recommendedQueueName',
        'recommendedDedupeKey',
        'notes',
        'metadata',
      ],
      properties: {
        action: { type: 'string', enum: this.allowedActions() },
        actor: { type: 'string', enum: ['AI', 'SYSTEM', 'WORKER', 'CLIENT', 'OPERATOR'] },
        jobType: { type: ['string', 'null'] },
        allowedToProceed: { type: 'boolean' },
        requiresHumanReview: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        reason: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } },
        nextActionAt: { type: ['string', 'null'] },
        recommendedQueueName: { type: ['string', 'null'] },
        recommendedDedupeKey: { type: ['string', 'null'] },
        notes: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object', additionalProperties: true },
      },
    };
  }

  private allowedActions(): AiAuthorityAction[] {
    return [
      'WAIT',
      'REQUEST_CLIENT_SETUP_COMPLETION',
      'GENERATE_AGREEMENT',
      'SEND_AGREEMENT',
      'WAIT_FOR_SIGNATURE',
      'CREATE_SUBSCRIPTION',
      'BLOCK_CAMPAIGN',
      'ACTIVATE_CAMPAIGN',
      'SOURCE_LEADS',
      'ADAPT_STRATEGY',
      'PAUSE_CAMPAIGN',
      'QUALIFY_LEAD',
      'SEND_FIRST_OUTREACH',
      'SEND_FOLLOW_UP',
      'PROCESS_REPLY',
      'HANDOFF_MEETING',
      'CREATE_INVOICE',
      'SEND_RECEIPT',
      'ESCALATE_OPERATOR',
      'STOP_LEAD',
      'REQUIRE_HUMAN_REVIEW',
      'DIAGNOSE_SYSTEM',
      'PROPOSE_CODE_UPGRADE',
      'PROPOSE_DESIGN_UPGRADE',
    ];
  }

  private normalizeDecision(raw: RawAuthorityResponse, input: AiAuthorityRequest, entity: AiAuthorityDecision['entity']): AiAuthorityDecision {
    const action = this.normalizeAction(raw.action) ?? input.preferredAction ?? 'WAIT';
    const risk = this.normalizeRisk(raw.risk);
    const confidence = this.clampConfidence(raw.confidence);
    const jobType = this.normalizeJobType(raw.jobType) ?? input.proposedJobType ?? null;

    return {
      scope: input.scope,
      entity,
      action,
      actor: this.normalizeActor(raw.actor),
      jobType,
      allowedToProceed: raw.allowedToProceed !== false,
      requiresHumanReview: Boolean(raw.requiresHumanReview),
      confidence,
      risk,
      reason: this.stringOrFallback(raw.reason, 'AI decision returned without a reason.'),
      evidence: this.stringArray(raw.evidence),
      blockers: this.stringArray(raw.blockers),
      nextActionAt: this.validDateString(raw.nextActionAt),
      recommendedQueueName: this.nonEmptyString(raw.recommendedQueueName),
      recommendedDedupeKey: this.nonEmptyString(raw.recommendedDedupeKey),
      notes: this.stringArray(raw.notes),
      metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    };
  }

  private normalizeAction(value: unknown): AiAuthorityAction | null {
    const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return this.allowedActions().includes(text as AiAuthorityAction) ? (text as AiAuthorityAction) : null;
  }

  private normalizeActor(value: unknown): AiAuthorityDecision['actor'] {
    const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (['AI', 'SYSTEM', 'WORKER', 'CLIENT', 'OPERATOR'].includes(text)) return text as AiAuthorityDecision['actor'];
    return 'AI';
  }

  private normalizeRisk(value: unknown): AiDecisionRisk {
    const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(text)) return text as AiDecisionRisk;
    return 'MEDIUM';
  }

  private normalizeJobType(value: unknown): JobType | null {
    const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const allowed = Object.values(JobType) as string[];
    return allowed.includes(text) ? (text as JobType) : null;
  }

  private clampConfidence(value: unknown) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) return 0.5;
    return Math.max(0, Math.min(1, number));
  }

  private stringOrFallback(value: unknown, fallback: string) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private stringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];
  }

  private nonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private validDateString(value: unknown) {
    const text = this.nonEmptyString(value);
    if (!text) return null;
    const time = Date.parse(text);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
}
