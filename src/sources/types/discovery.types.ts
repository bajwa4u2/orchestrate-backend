export interface DiscoveryCandidate {
  sourceType: string;
  companyName: string;
  personName?: string;
  inferredRole?: string;
  websiteUrl?: string;
  domain?: string;
  geography?: string;
  confidence: number;
  evidence: Record<string, unknown>;
}
