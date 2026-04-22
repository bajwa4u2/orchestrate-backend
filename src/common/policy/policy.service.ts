import {
  CollectionMethod,
  ContactPolicyDecision,
  EntityPolicyDecision,
  ExecutionPolicyDecision,
  SourcePolicyDecision,
} from './policy.types';
import { selfExclusionService } from './self-exclusion.service';

const SAFE_BUSINESS_LOCALPARTS = ['info', 'contact', 'hello', 'sales', 'team', 'support'];
const BLOCKED_LOCALPARTS = ['owner', 'admin', 'ceo', 'founder', 'president', 'manager', 'director'];

export class PolicyService {
  evaluateSource(input: {
    sourceType: string;
    websiteUrl?: string | null;
    domain?: string | null;
  }): SourcePolicyDecision {
    const sourceType = (input.sourceType || '').trim().toUpperCase();
    const domain = this.normalizeDomain(input.domain || input.websiteUrl);

    if (domain && selfExclusionService.isProtectedDomain(domain)) {
      return {
        status: 'BLOCKED',
        collectionMethod: 'PUBLIC_DISCOVERY',
        reason: 'self_domain_excluded',
      };
    }

    if (['SEARCH', 'DIRECTORY', 'WEBSITE', 'PUBLIC_WEB'].includes(sourceType)) {
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

    if (['PROVIDER', 'APOLLO'].includes(sourceType)) {
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

  evaluateEntity(input: {
    companyName?: string | null;
    personName?: string | null;
    domain?: string | null;
    websiteUrl?: string | null;
  }): EntityPolicyDecision {
    const domain = this.normalizeDomain(input.domain || input.websiteUrl);

    if (domain && selfExclusionService.isProtectedDomain(domain)) {
      return { status: 'BLOCKED', reason: 'self_domain_excluded', matchedToken: domain };
    }

    if (selfExclusionService.isProtectedName(input.companyName)) {
      return { status: 'BLOCKED', reason: 'self_company_excluded', matchedToken: input.companyName ?? null };
    }

    if (selfExclusionService.isProtectedName(input.personName)) {
      return { status: 'BLOCKED', reason: 'self_person_excluded', matchedToken: input.personName ?? null };
    }

    return { status: 'ALLOWED', reason: 'entity_allowed', matchedToken: null };
  }

  evaluateContact(input: {
    email?: string | null;
    sourceType?: string | null;
    domain?: string | null;
    inferredRole?: string | null;
  }): ContactPolicyDecision {
    const normalizedEmail = this.normalizeEmail(input.email);
    if (!normalizedEmail) {
      return { status: 'BLOCKED', reason: 'missing_contact_path', normalizedEmail: null };
    }

    if (selfExclusionService.isProtectedEmail(normalizedEmail)) {
      return { status: 'BLOCKED', reason: 'self_email_excluded', normalizedEmail };
    }

    const localPart = normalizedEmail.split('@')[0] || '';
    if (BLOCKED_LOCALPARTS.includes(localPart)) {
      return { status: 'BLOCKED', reason: 'risky_role_mailbox_blocked', normalizedEmail };
    }

    if (SAFE_BUSINESS_LOCALPARTS.includes(localPart)) {
      return { status: 'JUSTIFIED', reason: 'public_business_contact_style', normalizedEmail };
    }

    const sourceType = (input.sourceType || '').trim().toUpperCase();
    if (sourceType === 'WEBSITE' || sourceType === 'DIRECTORY') {
      return { status: 'REVIEW_REQUIRED', reason: 'non_generic_contact_requires_review', normalizedEmail };
    }

    if (input.inferredRole) {
      return { status: 'REVIEW_REQUIRED', reason: 'role_inferred_contact_requires_review', normalizedEmail };
    }

    return { status: 'BLOCKED', reason: 'contact_not_clearly_justified', normalizedEmail };
  }

  evaluateExecution(input: {
    email?: string | null;
    companyName?: string | null;
    domain?: string | null;
  }): ExecutionPolicyDecision {
    const contact = this.evaluateContact({ email: input.email, domain: input.domain });
    if (contact.status === 'BLOCKED') {
      return { status: 'BLOCKED', reason: contact.reason };
    }

    const entity = this.evaluateEntity({ companyName: input.companyName, domain: input.domain });
    if (entity.status === 'BLOCKED') {
      return { status: 'BLOCKED', reason: entity.reason };
    }

    return { status: 'ALLOWED', reason: 'execution_allowed' };
  }

  private normalizeEmail(value?: string | null) {
    const email = (value || '').trim().toLowerCase();
    return email.includes('@') ? email : null;
  }

  private normalizeDomain(value?: string | null) {
    const text = (value || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0]
      .trim();
    return text || null;
  }
}

export const policyService = new PolicyService();
