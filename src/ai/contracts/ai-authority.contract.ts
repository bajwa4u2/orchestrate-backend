import { JobType } from '@prisma/client';

export type AiAuthorityScope =
  | 'SYSTEM'
  | 'CLIENT'
  | 'CAMPAIGN'
  | 'LEAD'
  | 'REPLY'
  | 'MEETING'
  | 'BILLING'
  | 'AGREEMENT'
  | 'INVOICE'
  | 'SUPPORT'
  | 'CODE'
  | 'DESIGN';

export type AiAuthorityAction =
  | 'WAIT'
  | 'REQUEST_CLIENT_SETUP_COMPLETION'
  | 'GENERATE_AGREEMENT'
  | 'SEND_AGREEMENT'
  | 'WAIT_FOR_SIGNATURE'
  | 'CREATE_SUBSCRIPTION'
  | 'BLOCK_CAMPAIGN'
  | 'ACTIVATE_CAMPAIGN'
  | 'SOURCE_LEADS'
  | 'ADAPT_STRATEGY'
  | 'PAUSE_CAMPAIGN'
  | 'QUALIFY_LEAD'
  | 'SEND_FIRST_OUTREACH'
  | 'SEND_FOLLOW_UP'
  | 'PROCESS_REPLY'
  | 'HANDOFF_MEETING'
  | 'CREATE_INVOICE'
  | 'SEND_RECEIPT'
  | 'ESCALATE_OPERATOR'
  | 'STOP_LEAD'
  | 'REQUIRE_HUMAN_REVIEW'
  | 'DIAGNOSE_SYSTEM'
  | 'PROPOSE_CODE_UPGRADE'
  | 'PROPOSE_DESIGN_UPGRADE';

export type AiDecisionActor = 'AI' | 'SYSTEM' | 'WORKER' | 'CLIENT' | 'OPERATOR';
export type AiDecisionRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AiAuthorityEntityRef {
  organizationId?: string | null;
  clientId?: string | null;
  campaignId?: string | null;
  leadId?: string | null;
  replyId?: string | null;
  meetingId?: string | null;
  invoiceId?: string | null;
  agreementId?: string | null;
  jobId?: string | null;
  workflowRunId?: string | null;
}

export interface AiAuthorityDecision {
  scope: AiAuthorityScope;
  entity: AiAuthorityEntityRef;
  action: AiAuthorityAction;
  actor: AiDecisionActor;
  jobType?: JobType | null;
  allowedToProceed: boolean;
  requiresHumanReview: boolean;
  confidence: number;
  risk: AiDecisionRisk;
  reason: string;
  evidence: string[];
  blockers: string[];
  nextActionAt?: string | null;
  recommendedQueueName?: string | null;
  recommendedDedupeKey?: string | null;
  notes?: string[];
  metadata?: Record<string, unknown>;
}

export interface AiPolicyResult {
  allowed: boolean;
  hardBlocked: boolean;
  reason: string | null;
  blockers: string[];
  normalizedAction?: AiAuthorityAction;
  normalizedJobType?: JobType | null;
  requiresHumanReview?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AiAuthorityRequest {
  scope: AiAuthorityScope;
  entity: AiAuthorityEntityRef;
  question?: string;
  preferredAction?: AiAuthorityAction;
  proposedJobType?: JobType;
  operatorNote?: string;
  snapshot?: AiRealitySnapshot;
  dryRun?: boolean;
  recordDecision?: boolean;
}

export interface AiRealitySnapshot {
  snapshotVersion: '2026-04-ai-authority-v1';
  generatedAt: string;
  scope: AiAuthorityScope;
  entity: AiAuthorityEntityRef;
  client?: Record<string, unknown> | null;
  campaign?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  reply?: Record<string, unknown> | null;
  meeting?: Record<string, unknown> | null;
  billing?: Record<string, unknown> | null;
  agreements?: Record<string, unknown> | null;
  invoices?: Record<string, unknown> | null;
  jobs?: Record<string, unknown> | null;
  workflows?: Record<string, unknown> | null;
  activity?: Record<string, unknown> | null;
  support?: Record<string, unknown> | null;
  providers?: Record<string, unknown> | null;
  system?: Record<string, unknown> | null;
  warnings: string[];
}

export class AiAuthorityDecisionDto {
  scope!: AiAuthorityScope;
  entity!: AiAuthorityEntityRef;
  question?: string;
  preferredAction?: AiAuthorityAction;
  proposedJobType?: JobType;
  operatorNote?: string;
  dryRun?: boolean;
  recordDecision?: boolean;
}

export class AiRealitySnapshotDto {
  scope!: AiAuthorityScope;
  entity!: AiAuthorityEntityRef;
}

export class AiSystemDoctorDto {
  scope?: AiAuthorityScope;
  entity?: AiAuthorityEntityRef;
  issue!: string;
  expectedBehavior?: string;
  observedBehavior?: string;
  logs?: string[];
  harSummary?: unknown;
  apiResponses?: unknown;
  dbState?: unknown;
  files?: Array<{
    path: string;
    summary?: string;
    contentExcerpt?: string;
  }>;
  doNotTouch?: string[];
}

export class AiCodeUpgradeDto {
  objective!: string;
  currentProblem?: string;
  expectedBehavior?: string;
  affectedFiles?: Array<{
    path: string;
    summary?: string;
    contentExcerpt?: string;
  }>;
  constraints?: string[];
  doNotTouch?: string[];
  desiredOutput?: 'PLAN_ONLY' | 'FULL_REPLACEMENT_FILES' | 'RISK_REVIEW';
}

export class AiDesignReviewDto {
  surface!: 'PUBLIC' | 'CLIENT' | 'OPERATOR' | 'EMAIL' | 'BILLING' | 'AGREEMENT' | 'SYSTEM';
  objective!: string;
  currentExperience?: string;
  backendTruth?: unknown;
  screenshotsDescription?: string[];
  constraints?: string[];
}
