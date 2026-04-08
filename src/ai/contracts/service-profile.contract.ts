export interface ServiceProfileInput {
  organizationId: string;
  clientId: string;
  createdById?: string;
  businessName: string;
  websiteUrl?: string;
  industry: string;
  offerName: string;
  offerSummary: string;
  desiredOutcome: string;
  countries: string[];
  regions: string[];
  excludedRegions?: string[];
  buyerRoles: string[];
  buyerIndustries?: string[];
  tone?: string;
  callToAction?: string;
  bookingUrl?: string;
  complianceNotes?: string[];
  maxLeads?: number;
  dailySendCap?: number;
  sequenceStepCount?: number;
}
