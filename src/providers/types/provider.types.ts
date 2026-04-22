export type ProviderName = 'APOLLO';

export type ProviderReasonCode =
  | 'internal_paths_insufficient'
  | 'high_value_fallback'
  | 'operator_override'
  | 'continuity_last_resort';

export interface ProviderAvailability {
  provider: ProviderName;
  enabled: boolean;
  configured: boolean;
  mode: 'fallback_only';
}

export interface ProviderUsePolicyInput {
  campaignId: string;
  organizationId: string;
  clientId: string;
  reason: ProviderReasonCode;
  budgetUnitsRequested?: number;
  internalResultCount?: number;
}
