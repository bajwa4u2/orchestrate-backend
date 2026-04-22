import { Injectable } from '@nestjs/common';

@Injectable()
export class ProviderCostGuardService {
  approve(requestedUnits?: number) {
    const maxUnits = Number(process.env.PROVIDER_MAX_REQUESTED_UNITS || 25);
    const units = Math.max(0, requestedUnits ?? 0);
    if (units > maxUnits) {
      return { allowed: false, reason: 'provider_cost_guard_rejected', maxUnits };
    }
    return { allowed: true, reason: 'provider_cost_guard_passed', maxUnits };
  }
}
