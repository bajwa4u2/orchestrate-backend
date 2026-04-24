import { AiCapability, AiEngineResult, AiPurpose } from './ai-core.contract';

export type AiTrustDomain =
  | 'authority_decision'
  | 'system_diagnosis'
  | 'code_governance'
  | 'design_governance'
  | 'classification'
  | 'structured_output'
  | 'provider_routing'
  | 'cost_control'
  | 'long_context';

export type AiTrustSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type AiEvaluationJudgeMode = 'deterministic' | 'ai_judge' | 'hybrid';

export interface AiEvaluationCase<TInput = unknown, TExpected = unknown> {
  id: string;
  title: string;
  domain: AiTrustDomain;
  purpose: AiPurpose;
  capability: AiCapability;
  modelTier?: 'fast' | 'balanced' | 'reasoning' | 'code' | 'long_context';
  description: string;
  systemPrompt: string;
  input: TInput;
  expected: TExpected;
  schema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  judgeMode?: AiEvaluationJudgeMode;
  minimumScore?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface AiEvaluationSet {
  id: string;
  title: string;
  description: string;
  domains: AiTrustDomain[];
  version: string;
  cases: AiEvaluationCase[];
}

export interface AiEvaluationRunDto {
  setId?: string;
  caseIds?: string[];
  domains?: AiTrustDomain[];
  judgeMode?: AiEvaluationJudgeMode;
  dryRun?: boolean;
  maxCases?: number;
}

export interface AiEvaluationCaseResult {
  caseId: string;
  title: string;
  domain: AiTrustDomain;
  passed: boolean;
  score: number;
  minimumScore: number;
  judgeMode: AiEvaluationJudgeMode;
  expected: unknown;
  actual: unknown;
  issues: string[];
  warnings: string[];
  usage?: AiEngineResult['usage'] | null;
  latencyMs: number;
}

export interface AiEvaluationRunResult {
  ok: boolean;
  runId: string;
  startedAt: string;
  completedAt: string;
  setIds: string[];
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageScore: number;
  trustLevel: 'untrusted' | 'experimental' | 'working' | 'trusted' | 'high_trust';
  results: AiEvaluationCaseResult[];
  recommendations: string[];
}

export interface AiDecisionScoreDto {
  purpose: AiPurpose;
  capability: AiCapability;
  expected: unknown;
  actual: unknown;
  criteria?: string[];
  minimumScore?: number;
}

export interface AiDecisionScoreResult {
  passed: boolean;
  score: number;
  minimumScore: number;
  accuracy: number;
  completeness: number;
  safety: number;
  consistency: number;
  issues: string[];
  recommendations: string[];
}

export interface AiSelfCorrectionDto {
  purpose: AiPurpose;
  capability: AiCapability;
  systemPrompt: string;
  input: unknown;
  output: unknown;
  schema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  issues?: string[];
  maxCorrectionPasses?: number;
}

export interface AiSelfCorrectionResult<T = unknown> {
  corrected: boolean;
  output: T;
  confidence: number;
  passes: number;
  issuesResolved: string[];
  remainingIssues: string[];
  warnings: string[];
}

export interface AiSelfTriggerPlanDto {
  scope:
    | 'ai_core'
    | 'revenue_engine'
    | 'system_doctor'
    | 'code_governance'
    | 'design_governance'
    | 'client_lifecycle'
    | 'campaign_lifecycle';
  currentState?: unknown;
  recentEvents?: unknown[];
  failures?: unknown[];
  desiredOutcome?: string;
}

export interface AiSelfTriggerPlanResult {
  scope: AiSelfTriggerPlanDto['scope'];
  triggers: Array<{
    name: string;
    condition: string;
    action: string;
    priority: AiTrustSeverity;
    mode: 'observe' | 'suggest' | 'auto_correct' | 'block_and_escalate';
    cooldownMinutes: number;
    evidenceRequired: string[];
  }>;
  selfCorrectionRules: Array<{
    name: string;
    detects: string;
    correction: string;
    requiresHumanReview: boolean;
  }>;
  selfImprovementSignals: Array<{
    signal: string;
    whyItMatters: string;
    suggestedMetric: string;
  }>;
  risks: string[];
}

export interface AiImprovementPlanDto {
  evaluationRun?: AiEvaluationRunResult;
  usageSnapshot?: unknown;
  recentFailures?: unknown[];
  targetTrustLevel?: 'working' | 'trusted' | 'high_trust';
}

export interface AiImprovementPlanResult {
  targetTrustLevel: string;
  currentTrustLevel: string;
  priorities: Array<{
    title: string;
    reason: string;
    impact: AiTrustSeverity;
    effort: 'low' | 'medium' | 'high';
    filesOrServices: string[];
    acceptanceCriteria: string[];
  }>;
  evaluationCasesToAdd: Array<{
    title: string;
    domain: AiTrustDomain;
    reason: string;
  }>;
  guardrailsToTighten: string[];
  providerRoutingChanges: string[];
}



export interface AiOutcomeFeedbackDto {
  decisionId?: string;
  purpose: string;
  entity?: {
    organizationId?: string | null;
    clientId?: string | null;
    campaignId?: string | null;
    leadId?: string | null;
    jobId?: string | null;
    workflowRunId?: string | null;
  };
  expectedOutcome?: unknown;
  actualOutcome: unknown;
  success?: boolean;
  operatorRating?: 1 | 2 | 3 | 4 | 5;
  notes?: string;
}

export interface AiReadinessStatusResult {
  ok: boolean;
  mode: 'blocked' | 'capable_unproven' | 'observe_only' | 'suggest_ready' | 'trusted_ready';
  latestTrustLevel: string | null;
  latestAverageScore: number | null;
  gates: Array<{
    name: string;
    passed: boolean;
    severity: string;
    description: string;
  }>;
  usage: unknown;
  store: unknown;
  recommendation: string;
}
export interface AiTrustStatusResult {
  ok: boolean;
  layer: 'ai_trust';
  capabilities: {
    decisionScoring: boolean;
    accuracyTracking: boolean;
    automatedEvaluationSets: boolean;
    selfTriggerPlanning: boolean;
    selfCorrection: boolean;
    selfImprovementPlanning: boolean;
    outcomeFeedback: boolean;
    readinessGates: boolean;
    persistentTrustStore: boolean;
  };
  builtInEvaluationSets: Array<{
    id: string;
    title: string;
    version: string;
    caseCount: number;
    domains: AiTrustDomain[];
  }>;
  readiness?: AiReadinessStatusResult;
  recentEvaluationSummary: {
    runCount: number;
    latestRunId: string | null;
    latestTrustLevel: string | null;
    latestAverageScore: number | null;
  };
}
