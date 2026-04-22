import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { ProviderCostGuardService } from './provider-cost-guard.service';
import { ProviderFallbackService } from './provider-fallback.service';
import { ProviderPolicyService } from './provider-policy.service';
import { ProviderRegistryService } from './provider-registry.service';
import { ProvidersController } from './providers.controller';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [ProvidersController],
  providers: [
    ProviderRegistryService,
    ProviderPolicyService,
    ProviderCostGuardService,
    ProviderFallbackService,
  ],
  exports: [
    ProviderRegistryService,
    ProviderPolicyService,
    ProviderCostGuardService,
    ProviderFallbackService,
  ],
})
export class ProvidersModule {}
