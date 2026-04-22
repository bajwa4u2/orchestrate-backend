export type SourcePolicyStatus = 'ALLOWED' | 'RESTRICTED' | 'BLOCKED';
export type ContactPolicyStatus = 'JUSTIFIED' | 'REVIEW_REQUIRED' | 'BLOCKED';

export type CollectionMethod =
  | 'PUBLIC_DISCOVERY'
  | 'PUBLIC_RECORD_LOOKUP'
  | 'CLIENT_SUBMITTED'
  | 'INTERNAL_INFERENCE'
  | 'EXTERNAL_PROVIDER';

export function evaluateSourcePolicy(input: {
  sourceType: string;
  websiteUrl?: string | null;
  domain?: string | null;
  evidence?: unknown;
}): {
  status: SourcePolicyStatus;
  collectionMethod: CollectionMethod;
  reason: string;
} {
  const sourceType = (input.sourceType || '').toUpperCase();

  if (sourceType === 'SEARCH' || sourceType === 'DIRECTORY' || sourceType === 'WEBSITE') {
    return {
      status: 'ALLOWED',
      collectionMethod: 'PUBLIC_DISCOVERY',
      reason: 'public_business_discovery',
    };
  }

  if (sourceType === 'OPEN_DATA') {
    return {
      status: 'ALLOWED',
      collectionMethod: 'PUBLIC_RECORD_LOOKUP',
      reason: 'public_record_lookup',
    };
  }

  if (sourceType === 'PROVIDER' || sourceType === 'APOLLO') {
    return {
      status: 'RESTRICTED',
      collectionMethod: 'EXTERNAL_PROVIDER',
      reason: 'provider_fallback_only',
    };
  }

  return {
    status: 'BLOCKED',
    collectionMethod: 'INTERNAL_INFERENCE',
    reason: 'unapproved_source_type',
  };
}

export function evaluateContactPolicy(input: {
  email?: string | null;
  sourceType?: string | null;
  domain?: string | null;
  inferredRole?: string | null;
}): {
  status: ContactPolicyStatus;
  reason: string;
} {
  const email = (input.email || '').trim().toLowerCase();

  if (!email) {
    return { status: 'BLOCKED', reason: 'missing_contact_path' };
  }

  const localPart = email.split('@')[0] || '';

  if (['info', 'contact', 'hello', 'sales', 'team', 'support'].includes(localPart)) {
    return { status: 'JUSTIFIED', reason: 'public_business_contact_style' };
  }

  if (input.sourceType?.toUpperCase() === 'WEBSITE' || input.sourceType?.toUpperCase() === 'DIRECTORY') {
    return { status: 'REVIEW_REQUIRED', reason: 'non_generic_contact_requires_review' };
  }

  if (input.inferredRole) {
    return { status: 'REVIEW_REQUIRED', reason: 'role_inferred_contact_requires_review' };
  }

  return { status: 'BLOCKED', reason: 'contact_not_clearly_justified' };
}
