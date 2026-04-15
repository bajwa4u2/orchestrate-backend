export type LeadSourceProvider = 'APOLLO';

export interface LeadTargetingContext {
  campaignName?: string;
  objective?: string;
  offerSummary?: string;
  industry?: string;
  industries: string[];
  geoTargets: string[];
  titleKeywords: string[];
  exclusionKeywords: string[];
  employeeRanges: string[];
  seniorities: string[];
  maxResults: number;
}

export interface LeadSourceSearchInput {
  organizationId: string;
  clientId: string;
  campaignId: string;
  workflowRunId?: string;
  targeting: LeadTargetingContext;
}

export interface ExternalLeadCandidate {
  provider: LeadSourceProvider;
  providerPersonId?: string;
  providerOrganizationId?: string;
  externalReference?: string;
  companyName: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  contactFullName: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  emailStatus?: string;
  linkedinUrl?: string;
  city?: string;
  region?: string;
  countryCode?: string;
  timezone?: string;
  reasonForFit: string;
  qualificationNotes?: string;
  priority?: number;
  sourcePayload?: Record<string, unknown>;
}

export interface ExternalLeadSearchResult {
  provider: LeadSourceProvider;
  providerRef: string;
  querySummary: Record<string, unknown>;
  prospects: ExternalLeadCandidate[];
  importedCount: number;
  sendableCount: number;
}

export interface LeadSourceProviderContract {
  readonly provider: LeadSourceProvider;
  search(input: LeadSourceSearchInput): Promise<ExternalLeadSearchResult>;
}
