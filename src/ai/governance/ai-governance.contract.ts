import { JobType } from '@prisma/client';
import {
  AiAuthorityAction,
  AiAuthorityDecision,
  AiAuthorityEntityRef,
  AiAuthorityScope,
  AiRealitySnapshot,
} from '../contracts/ai-authority.contract';

export type AiGovernanceDecisionMode = 'required' | 'audit_only';
export type AiGovernanceOperation =
  | 'CREATE'
  | 'UPDATE'
  | 'QUEUE'
  | 'RUN'
  | 'CANCEL'
  | 'PAUSE'
  | 'RESUME'
  | 'SEND'
  | 'PROCESS'
  | 'GENERATE'
  | 'AUDIT';

export type AiGovernanceTrustMode = 'blocked' | 'observe' | 'suggest' | 'trusted';

export interface AiGovernanceSourceRef {
  layer: 'controller' | 'service' | 'worker' | 'system';
  service: string;
  method: string;
  endpoint?: string;
  worker?: string;
  reason?: string;
}

export interface AiGovernanceEntityLinkInput {
  entityType: string;
  entityId: string;
  role?: 'PRIMARY_SUBJECT' | 'CONTEXT' | 'TARGET' | 'RELATED' | 'OUTCOME_SUBJECT';
  metadata?: Record<string, unknown>;
}

export interface AiDecisionGatewayRequest {
  scope: AiAuthorityScope;
  entity: AiAuthorityEntityRef;
  preferredAction: AiAuthorityAction;
  proposedJobType?: JobType | null;
  question?: string;
  operatorNote?: string;
  source: AiGovernanceSourceRef;
  mode?: AiGovernanceDecisionMode;
  enforcement?: {
    entityType: string;
    entityId: string;
    operation: AiGovernanceOperation;
    workflowRunId?: string | null;
    jobId?: string | null;
  };
  entityLinks?: AiGovernanceEntityLinkInput[];
  expiresInSeconds?: number;
  metadata?: Record<string, unknown>;
  snapshot?: AiRealitySnapshot;
  dryRun?: boolean;
}

export interface AiDecisionGatewayResult {
  ok: boolean;
  decisionId: string | null;
  decision: AiAuthorityDecision;
  snapshot: AiRealitySnapshot;
  trustMode: AiGovernanceTrustMode;
  automationAllowed: boolean;
  requiresHumanReview: boolean;
  expiresAt: string | null;
  policyReasons: string[];
  links: AiGovernanceEntityLinkInput[];
}

export interface AiDecisionEnforcementRequest {
  decisionId: string;
  organizationId?: string | null;
  scope?: AiAuthorityScope;
  action?: AiAuthorityAction;
  entity?: AiAuthorityEntityRef;
  serviceName: string;
  methodName: string;
  entityType: string;
  entityId: string;
  operation: AiGovernanceOperation;
  workflowRunId?: string | null;
  jobId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AiDecisionEnforcementResult {
  ok: boolean;
  allowed: boolean;
  status:
    | 'ALLOWED'
    | 'BLOCKED'
    | 'EXPIRED'
    | 'NOT_FOUND'
    | 'ENTITY_MISMATCH'
    | 'POLICY_BLOCKED'
    | 'HUMAN_REVIEW_REQUIRED'
    | 'TRUST_BLOCKED'
    | 'AUDIT_ONLY';
  reason: string;
  decisionId: string | null;
  trustMode: AiGovernanceTrustMode | null;
  requiresHumanReview: boolean;
}

export interface AiDecisionOutcomeInput {
  decisionId: string;
  organizationId: string;
  clientId?: string | null;
  campaignId?: string | null;
  workflowRunId?: string | null;
  jobId?: string | null;
  entityType: string;
  entityId: string;
  outcomeType: string;
  status?: 'OBSERVED' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELED';
  score?: number | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  observedAt?: Date;
}

export interface AiGovernancePolicyEvaluation {
  trustMode: AiGovernanceTrustMode;
  automationAllowed: boolean;
  requiresHumanReview: boolean;
  threshold: number;
  expiresAt: Date | null;
  reasons: string[];
  policyBinding: {
    scope: AiAuthorityScope;
    action: AiAuthorityAction;
    trustMode: AiGovernanceTrustMode;
    requiredConfidence: number;
    requiresHumanReview: boolean;
    automationAllowed: boolean;
    mode: AiGovernanceDecisionMode;
    expiresAt: Date | null;
    metadata: Record<string, unknown>;
  };
}
