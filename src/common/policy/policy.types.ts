export type SourcePolicyStatus = 'ALLOWED' | 'RESTRICTED' | 'BLOCKED';
export type ContactPolicyStatus = 'JUSTIFIED' | 'REVIEW_REQUIRED' | 'BLOCKED';
export type EntityPolicyStatus = 'ALLOWED' | 'BLOCKED';
export type ExecutionPolicyStatus = 'ALLOWED' | 'BLOCKED';

export type CollectionMethod =
  | 'PUBLIC_DISCOVERY'
  | 'PUBLIC_RECORD_LOOKUP'
  | 'CLIENT_SUBMITTED'
  | 'INTERNAL_INFERENCE'
  | 'EXTERNAL_PROVIDER';

export interface SourcePolicyDecision {
  status: SourcePolicyStatus;
  collectionMethod: CollectionMethod;
  reason: string;
}

export interface ContactPolicyDecision {
  status: ContactPolicyStatus;
  reason: string;
  normalizedEmail: string | null;
}

export interface EntityPolicyDecision {
  status: EntityPolicyStatus;
  reason: string;
  matchedToken?: string | null;
}

export interface ExecutionPolicyDecision {
  status: ExecutionPolicyStatus;
  reason: string;
}
