import { Injectable } from '@nestjs/common';
import { ProviderAvailability } from './types/provider.types';

@Injectable()
export class ProviderRegistryService {
  listAvailability(): ProviderAvailability[] {
    const apolloConfigured = Boolean(process.env.APOLLO_API_KEY?.trim());
    const apolloEnabled = (process.env.APOLLO_ENABLED?.trim() || 'true').toLowerCase() !== 'false';

    return [
      {
        provider: 'APOLLO',
        configured: apolloConfigured,
        enabled: apolloConfigured && apolloEnabled,
        mode: 'fallback_only',
      },
    ];
  }

  isEnabled(provider: ProviderAvailability['provider']) {
    return this.listAvailability().some((item) => item.provider === provider && item.enabled);
  }
}
