import { Injectable } from '@nestjs/common';
import { ProviderUsePolicyInput } from './types/provider.types';

@Injectable()
export class ProviderPolicyService {
  canUseFallback(input: ProviderUsePolicyInput) {
    const hardDisabled = (process.env.PROVIDER_FALLBACK_ENABLED?.trim() || 'true').toLowerCase() === 'false';
    if (hardDisabled) {
      return { allowed: false, reason: 'provider_fallback_disabled' };
    }

    if ((input.internalResultCount ?? 0) > 0 && input.reason === 'internal_paths_insufficient') {
      return { allowed: false, reason: 'internal_paths_still_available' };
    }

    return { allowed: true, reason: 'fallback_policy_passed' };
  }
}
