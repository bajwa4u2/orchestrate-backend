import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { buildPagination } from '../common/utils/pagination';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { StripeService } from '../billing/stripe/stripe.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientSetupDto } from './dto/create-client-setup.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';
import { UpdateCampaignProfileDto } from './dto/update-campaign-profile.dto';

type ServiceType = 'opportunity' | 'revenue';
type ScopeMode = 'focused' | 'multi' | 'precision';

type SetupCountry = { code: string; label: string };
type SetupRegion = {
  countryCode: string;
  countryLabel: string;
  regionType: string;
  regionCode: string;
  regionLabel: string;
};
type SetupMetro = { countryCode: string; regionCode: string; label: string };
type SetupIndustry = { code: string; label: string };

type ScopeJson = {
  version: 2;
  lane: ServiceType;
  mode: ScopeMode;
  coverage: string[];
  countries: SetupCountry[];
  regions: SetupRegion[];
  metros: SetupMetro[];
  industries: SetupIndustry[];
  includeGeo: string[];
  excludeGeo: string[];
  priorityMarkets: string[];
  notes: string | null;
  recommendedPlan: {
    lane: ServiceType;
    tier: ScopeMode;
    code: string;
  };
};

@Injectable()
export class ClientsService {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly campaignsService: CampaignsService,
  ) {}

  create(dto: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        organizationId: dto.organizationId,
        createdById: dto.createdById,
        code: dto.code,
        legalName: dto.legalName,
        displayName: dto.displayName,
        status: dto.status,
        industry: dto.industry,
        websiteUrl: dto.websiteUrl,
        bookingUrl: dto.bookingUrl,
        primaryTimezone: dto.primaryTimezone,
        currencyCode: dto.currencyCode,
        outboundOffer: dto.outboundOffer,
        notesText: dto.notesText,
        metadataJson: toPrismaJson(dto.metadataJson),
        isInternal: dto.isInternal,
      },
    });
  }

  async list(query: ListClientsDto) {
    const { page, limit, skip, take } = buildPagination(query.page, query.limit);
    const where = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' as const } },
              { legalName: { contains: query.search, mode: 'insensitive' as const } },
              { industry: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { organization: true },
        skip,
        take,
      }),
      this.prisma.client.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  async getSetup(headers: Record<string, unknown>) {
    const client = await this.resolveClientForRequest(headers);
    const metadata = this.asObject(client.metadataJson);
    const setup = this.asObject(metadata.setup);
    const scope = this.readStructuredScope(setup.scope ?? client.scopeJson);
    const setupSelectedPlan =
      this.readString(setup.selectedPlan) ?? client.selectedPlan ?? scope.recommendedPlan.code;
    const setupSelectedTier = this.readString(setup.selectedTier) ?? scope.recommendedPlan.tier;
    const commercial = await this.resolveCommercialState(client.id);

    return {
      clientId: client.id,
      organizationId: client.organizationId,
      emailVerified: true,
      setupCompleted: Boolean(client.setupCompletedAt),
      setupCompletedAt: client.setupCompletedAt,
      selectedPlan: commercial.service ?? setupSelectedPlan,
      selectedTier: commercial.tier ?? setupSelectedTier,
      setupSelectedPlan,
      setupSelectedTier,
      subscriptionStatus: commercial.status,
      commercial,
      setup: client.setupCompletedAt
        ? {
            serviceType: scope.lane,
            scopeMode: scope.mode,
            countries: scope.countries,
            regions: scope.regions,
            metros: scope.metros,
            industries: scope.industries,
            includeGeo: scope.includeGeo,
            excludeGeo: scope.excludeGeo,
            priorityMarkets: scope.priorityMarkets,
            notes: scope.notes,
            selectedPlan: setupSelectedPlan,
            selectedTier: setupSelectedTier,
            recommendedPlan: scope.recommendedPlan,
            scope,
            legacy: {
              country: client.country,
              area: client.area,
              industry: client.industry,
            },
          }
        : null,
    };
  }

  async saveSetup(headers: Record<string, unknown>, dto: CreateClientSetupDto) {
    const client = await this.resolveClientForRequest(headers);
    const lane = this.normalizeServiceType(dto.serviceType);
    const requestedTier = this.normalizeScopeMode(dto.scopeMode);
    const countries = this.normalizeCountries(dto.countries);
    const regions = this.normalizeRegions(dto.regions, countries);
    const metros = this.normalizeMetros(dto.metros ?? [], countries, regions);
    const industries = this.normalizeIndustries(dto.industries);
    const includeGeo = this.normalizeStringList(dto.includeGeo ?? [], 40, 120);
    const excludeGeo = this.normalizeStringList(dto.excludeGeo ?? [], 40, 120);
    const priorityMarkets = this.normalizeStringList(dto.priorityMarkets ?? [], 20, 120);
    const notes = this.normalizeOptionalString(dto.notes, 500);

    this.validateScope(requestedTier, countries, regions, metros, includeGeo, excludeGeo, priorityMarkets);

    const recommendedTier = this.recommendTier(countries, metros, includeGeo, excludeGeo, priorityMarkets);
    if (recommendedTier !== requestedTier) {
      throw new BadRequestException(
        `This setup fits the ${recommendedTier} tier. Update the selected tier to continue.`,
      );
    }

    const selectedPlan = lane;
    const selectedTier = requestedTier;
    const scope = this.buildScopeJson({
      lane,
      mode: selectedTier,
      countries,
      regions,
      metros,
      industries,
      includeGeo,
      excludeGeo,
      priorityMarkets,
      notes,
    });

    const metadata = this.asObject(client.metadataJson);
    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: {
        country: countries[0]?.label ?? null,
        area: this.buildAreaSummary(regions, metros),
        industry: industries[0]?.label ?? null,
        scopeJson: scope as unknown as Prisma.InputJsonValue,
        selectedPlan,
        setupCompletedAt: new Date(),
        metadataJson: toPrismaJson({
          ...metadata,
          setup: {
            serviceType: lane,
            scopeMode: selectedTier,
            countries,
            regions,
            metros,
            industries,
            includeGeo,
            excludeGeo,
            priorityMarkets,
            notes,
            selectedPlan,
            selectedTier,
            recommendedPlan: scope.recommendedPlan,
            scope,
          },
        }),
      },
    });

    const commercial = await this.resolveCommercialState(updated.id);
    const normalizedStatus = commercial.status.toLowerCase();
    const nextRoute = normalizedStatus === 'active'
      ? '/client/workspace'
      : `/client/subscribe?plan=${selectedPlan}&tier=${selectedTier}`;

    return {
      success: true,
      client: {
        clientId: updated.id,
        organizationId: updated.organizationId,
        emailVerified: true,
        setupCompleted: true,
        setupCompletedAt: updated.setupCompletedAt,
        selectedPlan: commercial.service ?? updated.selectedPlan,
        selectedTier: commercial.tier ?? selectedTier,
        setupSelectedPlan: selectedPlan,
        setupSelectedTier: selectedTier,
        subscriptionStatus: normalizedStatus,
        commercial,
        setup: {
          serviceType: lane,
          scopeMode: selectedTier,
          countries,
          regions,
          metros,
          industries,
          includeGeo,
          excludeGeo,
          priorityMarkets,
          notes,
          selectedPlan,
          selectedTier,
          recommendedPlan: scope.recommendedPlan,
          scope,
        },
      },
      nextRoute,
    };
  }

  async deactivateAccount(headers: Record<string, unknown>) {
    const client = await this.resolveClientForRequest(headers);

    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: {
        clientId: client.id,
        status: {
          in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
      },
      select: {
        id: true,
        externalRef: true,
        metadataJson: true,
      },
    });

    const stripe = this.stripeService.getClient();
    for (const subscription of activeSubscriptions) {
      if (!subscription.externalRef) continue;
      await stripe.subscriptions.cancel(subscription.externalRef);
    }

    const now = new Date();
    const clientMetadata = this.asObject(client.metadataJson);
    const accountMetadata = this.asObject(clientMetadata.account);

    await this.prisma.$transaction([
      this.prisma.subscription.updateMany({
        where: {
          clientId: client.id,
          status: {
            in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
          },
        },
        data: {
          status: SubscriptionStatus.CANCELED,
          canceledAt: now,
        },
      }),
      this.prisma.workspaceMember.updateMany({
        where: { organizationId: client.organizationId, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.client.update({
        where: { id: client.id },
        data: {
          metadataJson: toPrismaJson({
            ...clientMetadata,
            account: {
              ...accountMetadata,
              deactivatedAt: now.toISOString(),
              deactivatedBy: 'client',
            },
          }),
        },
      }),
    ]);

    return {
      success: true,
      clientId: client.id,
      organizationId: client.organizationId,
      deactivatedAt: now.toISOString(),
      subscriptionsCanceled: activeSubscriptions.length,
      nextRoute: '/client/login',
    };
  }

  async getProfile(headers: Record<string, unknown>) {
    const client = await this.resolveClientForRequest(headers);
    return this.buildProfileResponse(client);
  }

  async saveProfile(headers: Record<string, unknown>, dto: UpdateClientProfileDto) {
    const client = await this.resolveClientForRequest(headers);
    const metadata = this.asObject(client.metadataJson);
    const branding = this.asObject(metadata.branding);

    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: {
        displayName: dto.displayName?.trim() || client.displayName,
        legalName: dto.legalName?.trim() || client.legalName,
        websiteUrl: dto.websiteUrl?.trim() || null,
        bookingUrl: dto.bookingUrl?.trim() || null,
        primaryTimezone: dto.primaryTimezone?.trim() || null,
        currencyCode: dto.currencyCode?.trim().toUpperCase() || client.currencyCode,
        metadataJson: toPrismaJson({
          ...metadata,
          branding: {
            ...branding,
            brandName: dto.brandName?.trim() || this.readString(branding.brandName) || client.displayName,
            logoUrl: dto.logoUrl?.trim() || null,
            primaryColor: dto.primaryColor?.trim() || this.readString(branding.primaryColor) || '#111827',
            accentColor: dto.accentColor?.trim() || this.readString(branding.accentColor) || '#2563eb',
            welcomeHeadline:
              dto.welcomeHeadline?.trim() ||
              this.readString(branding.welcomeHeadline) ||
              'Your account is configured for active service operations.',
          },
        }),
      },
    });

    return {
      success: true,
      profile: this.buildProfileResponse(updated).profile,
    };
  }


  async getCampaignProfile(headers: Record<string, unknown>) {
    const client = await this.resolveClientForRequest(headers);
    const metadata = this.asObject(client.metadataJson);
    const setup = this.asObject(metadata.setup);
    const scope = this.readStructuredScope(setup.scope ?? client.scopeJson);
    const commercial = await this.resolveCommercialState(client.id);
    const campaign = await this.findPrimaryAutomationCampaign(client.organizationId, client.id);

    return {
      success: true,
      clientId: client.id,
      organizationId: client.organizationId,
      campaignProfile: {
        serviceType: scope.lane,
        scopeMode: scope.mode,
        countries: scope.countries,
        regions: scope.regions,
        metros: scope.metros,
        industries: scope.industries,
        includeGeo: scope.includeGeo,
        excludeGeo: scope.excludeGeo,
        priorityMarkets: scope.priorityMarkets,
        notes: scope.notes,
        recommendedPlan: scope.recommendedPlan,
        subscriptionAlignment: this.buildSubscriptionAlignment(commercial, scope),
        campaign: this.buildCampaignActivationPayload(campaign),
      },
    };
  }

  async updateCampaignProfile(
    headers: Record<string, unknown>,
    dto: UpdateCampaignProfileDto,
  ) {
    const client = await this.resolveClientForRequest(headers);
    const metadata = this.asObject(client.metadataJson);
    const setup = this.asObject(metadata.setup);
    const currentScope = this.readStructuredScope(setup.scope ?? client.scopeJson);

    const countries = dto.countries !== undefined
      ? this.normalizeCountries(dto.countries)
      : currentScope.countries;

    const regions = dto.regions !== undefined
      ? this.normalizeRegions(dto.regions, countries)
      : currentScope.regions;

    const metros = dto.metros !== undefined
      ? this.normalizeMetros(dto.metros, countries, regions)
      : currentScope.metros;

    const industries = dto.industries !== undefined
      ? this.normalizeIndustries(dto.industries)
      : currentScope.industries;

    const includeGeo = dto.includeGeo !== undefined
      ? this.normalizeStringList(dto.includeGeo, 40, 120)
      : currentScope.includeGeo;

    const excludeGeo = dto.excludeGeo !== undefined
      ? this.normalizeStringList(dto.excludeGeo, 40, 120)
      : currentScope.excludeGeo;

    const priorityMarkets = dto.priorityMarkets !== undefined
      ? this.normalizeStringList(dto.priorityMarkets, 20, 120)
      : currentScope.priorityMarkets;

    const notes = dto.notes !== undefined
      ? this.normalizeOptionalString(dto.notes, 500)
      : currentScope.notes;

    const recommendedTier = this.recommendTier(
      countries,
      metros,
      includeGeo,
      excludeGeo,
      priorityMarkets,
    );

    this.validateScope(
      recommendedTier,
      countries,
      regions,
      metros,
      includeGeo,
      excludeGeo,
      priorityMarkets,
    );

    const scope = this.buildScopeJson({
      lane: currentScope.lane,
      mode: recommendedTier,
      countries,
      regions,
      metros,
      industries,
      includeGeo,
      excludeGeo,
      priorityMarkets,
      notes,
    });

    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: {
        country: countries[0]?.label ?? null,
        area: this.buildAreaSummary(regions, metros),
        industry: industries[0]?.label ?? null,
        scopeJson: scope as unknown as Prisma.InputJsonValue,
        selectedPlan: currentScope.lane,
        metadataJson: toPrismaJson({
          ...metadata,
          setup: {
            ...setup,
            serviceType: currentScope.lane,
            scopeMode: recommendedTier,
            countries,
            regions,
            metros,
            industries,
            includeGeo,
            excludeGeo,
            priorityMarkets,
            notes,
            selectedPlan: currentScope.lane,
            selectedTier: recommendedTier,
            recommendedPlan: scope.recommendedPlan,
            scope,
          },
        }),
      },
    });

    const commercial = await this.resolveCommercialState(updated.id);

    return {
      success: true,
      clientId: updated.id,
      organizationId: updated.organizationId,
      campaignProfile: {
        serviceType: scope.lane,
        scopeMode: scope.mode,
        countries: scope.countries,
        regions: scope.regions,
        metros: scope.metros,
        industries: scope.industries,
        includeGeo: scope.includeGeo,
        excludeGeo: scope.excludeGeo,
        priorityMarkets: scope.priorityMarkets,
        notes: scope.notes,
        recommendedPlan: scope.recommendedPlan,
        subscriptionAlignment: this.buildSubscriptionAlignment(commercial, scope),
      },
    };
  }


  async startCampaign(headers: Record<string, unknown>) {
    const client = await this.resolveClientForRequest(headers);
    const metadata = this.asObject(client.metadataJson);
    const setup = this.asObject(metadata.setup);
    const scope = this.readStructuredScope(setup.scope ?? client.scopeJson);
    const commercial = await this.resolveCommercialState(client.id);
    const subscriptionAlignment = this.buildSubscriptionAlignment(commercial, scope);

    if (!commercial.service || !commercial.tier) {
      return {
        success: false,
        status: 'upgrade_required',
        clientId: client.id,
        organizationId: client.organizationId,
        message: 'Activate a valid subscription before starting this campaign.',
        campaignId: null,
        jobId: null,
        campaign: null,
      };
    }

    if (!subscriptionAlignment.tierCovered) {
      return {
        success: false,
        status: 'upgrade_required',
        clientId: client.id,
        organizationId: client.organizationId,
        message: this.buildUpgradeMessage(scope, subscriptionAlignment),
        campaignId: null,
        jobId: null,
        campaign: null,
      };
    }

    const effectiveLane: ServiceType = commercial.service ?? scope.lane;
    const effectiveScope = this.buildScopeJson({
      lane: effectiveLane,
      mode: scope.mode,
      countries: scope.countries,
      regions: scope.regions,
      metros: scope.metros,
      industries: scope.industries,
      includeGeo: scope.includeGeo,
      excludeGeo: scope.excludeGeo,
      priorityMarkets: scope.priorityMarkets,
      notes: scope.notes,
    });

    if (effectiveLane !== scope.lane) {
      await this.prisma.client.update({
        where: { id: client.id },
        data: {
          selectedPlan: effectiveLane,
          scopeJson: effectiveScope as unknown as Prisma.InputJsonValue,
          metadataJson: toPrismaJson({
            ...metadata,
            setup: {
              ...setup,
              serviceType: effectiveLane,
              selectedPlan: effectiveLane,
              selectedTier: effectiveScope.mode,
              recommendedPlan: effectiveScope.recommendedPlan,
              scope: effectiveScope,
            },
          }),
        },
      });
    }

    let campaign = await this.findPrimaryAutomationCampaign(client.organizationId, client.id);

    if (!campaign) {
      const created = await this.campaignsService.create({
        organizationId: client.organizationId,
        clientId: client.id,
        code: 'PRIMARY_AUTOMATION',
        name: 'Primary Automation',
        status: 'READY',
        channel: 'EMAIL',
        objective: this.buildCampaignObjective(effectiveScope),
        offerSummary: this.buildCampaignOfferSummary(effectiveScope),
        bookingUrlOverride: client.bookingUrl ?? undefined,
        timezone: client.primaryTimezone ?? undefined,
        metadataJson: {
          source: 'client_campaign_start',
          setupSource: 'client_campaign_profile',
          lane: effectiveScope.lane,
          mode: effectiveScope.mode,
          countries: effectiveScope.countries,
          regions: effectiveScope.regions,
          metros: effectiveScope.metros,
          industries: effectiveScope.industries,
          includeGeo: effectiveScope.includeGeo,
          excludeGeo: effectiveScope.excludeGeo,
          priorityMarkets: effectiveScope.priorityMarkets,
          notes: effectiveScope.notes,
        },
      } as any);

      campaign = await this.findPrimaryAutomationCampaign(client.organizationId, client.id, created.id);
    }

    const activation = await this.campaignsService.activateCampaign({
      campaignId: campaign!.id,
      organizationId: client.organizationId,
    });

    const refreshedCampaign =
      (await this.findPrimaryAutomationCampaign(client.organizationId, client.id, campaign!.id)) ?? campaign;

    return {
      success: true,
      status: activation.status,
      clientId: client.id,
      organizationId: client.organizationId,
      campaignId: refreshedCampaign?.id ?? campaign!.id,
      generationState: activation.generationState ?? refreshedCampaign?.generationState ?? null,
      bootstrapStatus: activation.bootstrapStatus ?? null,
      jobId: activation.jobId ?? null,
      deduped: Boolean(activation.deduped),
      message: activation.message,
      campaign: this.buildCampaignActivationPayload(refreshedCampaign),
    };
  }



  private async findPrimaryAutomationCampaign(
    organizationId: string,
    clientId: string,
    preferredCampaignId?: string,
  ) {
    if (preferredCampaignId) {
      const preferred = await this.prisma.campaign.findFirst({
        where: {
          id: preferredCampaignId,
          organizationId,
          clientId,
        },
      });
      if (preferred) return preferred;
    }

    return this.prisma.campaign.findFirst({
      where: {
        organizationId,
        clientId,
        code: 'PRIMARY_AUTOMATION',
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  private buildCampaignActivationPayload(
    campaign:
      | {
          id: string;
          status: string;
          generationState: string | null;
          metadataJson: unknown;
          updatedAt?: Date;
        }
      | null
      | undefined,
  ) {
    if (!campaign) return null;

    const metadata = this.asObject(campaign.metadataJson);
    const activation = this.asObject(metadata.activation);

    return {
      id: campaign.id,
      status: campaign.status,
      generationState: campaign.generationState,
      activation: {
        version: this.readPositiveInt(activation.version),
        bootstrapStatus: this.readString(activation.bootstrapStatus),
        requestedAt: this.readString(activation.requestedAt),
        retryAt: this.readString(activation.retryAt),
        completedAt: this.readString(activation.completedAt),
        failedAt: this.readString(activation.failedAt),
        jobId: this.readString(activation.jobId),
        dedupeKey: this.readString(activation.dedupeKey),
        lastError: this.readString(activation.lastError),
      },
      updatedAt: campaign.updatedAt?.toISOString() ?? null,
    };
  }
  private buildUpgradeMessage(
    scope: ScopeJson,
    subscriptionAlignment?: {
      currentService: ServiceType | null;
      currentTier: ScopeMode | null;
      recommendedService: ServiceType;
      recommendedTier: ScopeMode;
      tierCovered: boolean;
      laneMismatch: boolean;
    },
  ) {
    if (subscriptionAlignment?.laneMismatch && subscriptionAlignment.tierCovered) {
      return 'Your subscription covers this targeting. The campaign lane was aligned to your active service automatically.';
    }
    if (scope.mode === 'precision') {
      return 'Expand your plan to target city-level markets and advanced targeting.';
    }
    if (scope.mode === 'multi') {
      return 'Expand your plan to target multiple countries.';
    }
    return 'Update your plan to start this campaign with the current targeting.';
  }

  private buildCampaignObjective(scope: ScopeJson) {
    if (scope.lane === 'revenue') {
      return 'Revenue operations are being launched from your saved targeting and service coverage.';
    }
    return 'We are launching outbound outreach from your saved targeting to generate qualified meetings.';
  }

  private buildCampaignOfferSummary(scope: ScopeJson) {
    const industry = scope.industries[0]?.label;
    if (scope.lane === 'revenue') {
      return industry
        ? `Revenue operations are being prepared for ${industry} targets using your saved campaign coverage.`
        : 'Revenue operations are being prepared using your saved campaign coverage.';
    }
    return industry
      ? `We are finding ${industry} prospects and preparing outreach using your saved targeting.`
      : 'We are finding prospects and preparing outreach using your saved targeting.';
  }

  private buildProfileResponse(client: any) {
    const metadata = this.asObject(client.metadataJson);
    const branding = this.asObject(metadata.branding);

    return {
      profile: {
        displayName: client.displayName,
        legalName: client.legalName,
        websiteUrl: client.websiteUrl,
        bookingUrl: client.bookingUrl,
        primaryTimezone: client.primaryTimezone,
        currencyCode: client.currencyCode,
        primaryEmail: client.primaryEmail,
        billingEmail: client.billingEmail,
        branding: {
          brandName: this.readString(branding.brandName) ?? client.displayName,
          logoUrl: this.readString(branding.logoUrl),
          primaryColor: this.readString(branding.primaryColor) ?? '#111827',
          accentColor: this.readString(branding.accentColor) ?? '#2563eb',
          welcomeHeadline:
            this.readString(branding.welcomeHeadline) ??
            'Your account is configured for active service operations.',
        },
      },
    };
  }

  private async resolveClientForRequest(headers: Record<string, unknown>) {
    const context = await this.accessContextService.buildFromHeaders(headers);

    if (!context.userId) {
      throw new UnauthorizedException('No active session');
    }

    if (context.surface !== 'client') {
      throw new UnauthorizedException('Client access is required');
    }

    let client: any = null;

    if (context.clientId) {
      client = await this.prisma.client.findUnique({ where: { id: context.clientId } });
    }

    if (!client && context.organizationId) {
      client = await this.prisma.client.findFirst({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!client) {
      throw new NotFoundException('Client account not found');
    }

    const metadata = this.asObject(client.metadataJson);
    const account = this.asObject(metadata.account);
    if (this.readString(account.deactivatedAt)) {
      throw new UnauthorizedException('This client account is no longer active.');
    }

    return client;
  }


  private buildSubscriptionAlignment(
    commercial: {
      status: string;
      service: ServiceType | null;
      tier: ScopeMode | null;
      planCode: string | null;
      planName: string | null;
    },
    scope: ScopeJson,
  ) {
    const currentTier = commercial.tier;
    const currentService = commercial.service;
    const recommendedTier = scope.mode;
    const recommendedService = scope.lane;
    const tierCovered = this.tierRank(currentTier) >= this.tierRank(recommendedTier);
    const laneMismatch = Boolean(currentService && currentService !== recommendedService);

    return {
      subscriptionStatus: commercial.status,
      currentService,
      currentTier,
      recommendedService,
      recommendedTier,
      matchesCurrentSubscription: tierCovered,
      tierCovered,
      laneMismatch,
      upgradeSuggested: !tierCovered,
      downgradePossible:
        this.tierRank(currentTier) > this.tierRank(recommendedTier),
    };
  }

  private tierRank(value: string | null | undefined) {
    if (value === 'precision') return 3;
    if (value === 'multi') return 2;
    if (value === 'focused') return 1;
    return 0;
  }

  private normalizeServiceType(value: string): ServiceType {
    return value.trim().toLowerCase() === 'revenue' ? 'revenue' : 'opportunity';
  }

  private normalizeScopeMode(value: string): ScopeMode {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'multi' || normalized === 'precision') return normalized;
    return 'focused';
  }

  private normalizeCountries(input: Array<{ code: string; label: string }>): SetupCountry[] {
    const seen = new Set<string>();
    const countries: SetupCountry[] = [];
    for (const item of input ?? []) {
      const code = item.code?.trim().toUpperCase();
      const label = item.label?.trim();
      if (!code || !label || seen.has(code)) continue;
      seen.add(code);
      countries.push({ code, label });
    }
    if (!countries.length) throw new BadRequestException('Add at least one country to continue.');
    return countries;
  }

  private normalizeRegions(
    input: Array<{ countryCode: string; countryLabel: string; regionType: string; regionCode: string; regionLabel: string }>,
    countries: SetupCountry[],
  ): SetupRegion[] {
    const allowedCountries = new Set(countries.map((item) => item.code));
    const seen = new Set<string>();
    const regions: SetupRegion[] = [];
    for (const item of input ?? []) {
      const countryCode = item.countryCode?.trim().toUpperCase();
      const countryLabel = item.countryLabel?.trim();
      const regionType = item.regionType?.trim();
      const regionCode = item.regionCode?.trim();
      const regionLabel = item.regionLabel?.trim();
      const key = `${countryCode}:${regionCode}`;
      if (!countryCode || !countryLabel || !regionType || !regionCode || !regionLabel) continue;
      if (!allowedCountries.has(countryCode) || seen.has(key)) continue;
      seen.add(key);
      regions.push({ countryCode, countryLabel, regionType, regionCode, regionLabel });
    }
    if (!regions.length) throw new BadRequestException('Add at least one region to continue.');
    return regions;
  }

  private normalizeMetros(
    input: Array<{ countryCode: string; regionCode: string; label: string }>,
    countries: SetupCountry[],
    regions: SetupRegion[],
  ): SetupMetro[] {
    const allowedCountries = new Set(countries.map((item) => item.code));
    const allowedRegions = new Set(regions.map((item) => `${item.countryCode}:${item.regionCode}`));
    const seen = new Set<string>();
    const metros: SetupMetro[] = [];
    for (const item of input ?? []) {
      const countryCode = item.countryCode?.trim().toUpperCase();
      const regionCode = item.regionCode?.trim();
      const label = item.label?.trim();
      const key = `${countryCode}:${regionCode}:${label?.toLowerCase()}`;
      if (!countryCode || !regionCode || !label) continue;
      if (!allowedCountries.has(countryCode) || !allowedRegions.has(`${countryCode}:${regionCode}`) || seen.has(key)) continue;
      seen.add(key);
      metros.push({ countryCode, regionCode, label });
    }
    return metros;
  }

  private normalizeIndustries(input: Array<{ code: string; label: string }>): SetupIndustry[] {
    const seen = new Set<string>();
    const industries: SetupIndustry[] = [];
    for (const item of input ?? []) {
      const code = item.code?.trim();
      const label = item.label?.trim();
      if (!code || !label || seen.has(code)) continue;
      seen.add(code);
      industries.push({ code, label });
    }
    if (!industries.length) throw new BadRequestException('Add at least one industry to continue.');
    return industries;
  }

  private normalizeStringList(input: string[], maxItems: number, maxLength: number) {
    const values: string[] = [];
    const seen = new Set<string>();
    for (const raw of input ?? []) {
      const value = typeof raw === 'string' ? raw.trim() : '';
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      values.push(value.slice(0, maxLength));
      if (values.length >= maxItems) break;
    }
    return values;
  }

  private normalizeOptionalString(value: string | undefined, maxLength: number) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length ? normalized.slice(0, maxLength) : null;
  }

  private validateScope(
    mode: ScopeMode,
    countries: SetupCountry[],
    regions: SetupRegion[],
    metros: SetupMetro[],
    includeGeo: string[],
    excludeGeo: string[],
    priorityMarkets: string[],
  ) {
    if (mode === 'focused') {
      if (countries.length !== 1) {
        throw new BadRequestException('Focused setup must stay within one country.');
      }
      if (includeGeo.length || excludeGeo.length || priorityMarkets.length) {
        throw new BadRequestException('Focused setup does not support advanced market controls.');
      }
      const countryCode = countries[0].code;
      const foreignRegion = regions.find((item) => item.countryCode !== countryCode);
      if (foreignRegion) {
        throw new BadRequestException('Focused setup must use regions from the selected country only.');
      }
      return;
    }

    if (mode === 'multi') {
      if (countries.length < 2) {
        throw new BadRequestException('Multi setup must include more than one country.');
      }
      if (includeGeo.length || excludeGeo.length || priorityMarkets.length) {
        throw new BadRequestException('Advanced market controls belong to the precision tier.');
      }
      return;
    }

    if (!regions.length) {
      throw new BadRequestException('Precision setup requires at least one region.');
    }
    if (!metros.length && !includeGeo.length && !excludeGeo.length && !priorityMarkets.length) {
      throw new BadRequestException('Precision setup requires metros, advanced market controls, or priority markets.');
    }
  }

  private recommendTier(
    countries: SetupCountry[],
    metros: SetupMetro[],
    includeGeo: string[],
    excludeGeo: string[],
    priorityMarkets: string[],
  ): ScopeMode {
    if (metros.length || includeGeo.length || excludeGeo.length || priorityMarkets.length) {
      return 'precision';
    }
    if (countries.length > 1) {
      return 'multi';
    }
    return 'focused';
  }

  private buildScopeJson(input: {
    lane: ServiceType;
    mode: ScopeMode;
    countries: SetupCountry[];
    regions: SetupRegion[];
    metros: SetupMetro[];
    industries: SetupIndustry[];
    includeGeo: string[];
    excludeGeo: string[];
    priorityMarkets: string[];
    notes: string | null;
  }): ScopeJson {
    return {
      version: 2,
      lane: input.lane,
      mode: input.mode,
      coverage: this.coverageFor(input.lane),
      countries: input.countries,
      regions: input.regions,
      metros: input.metros,
      industries: input.industries,
      includeGeo: input.includeGeo,
      excludeGeo: input.excludeGeo,
      priorityMarkets: input.priorityMarkets,
      notes: input.notes,
      recommendedPlan: {
        lane: input.lane,
        tier: input.mode,
        code: input.lane,
      },
    };
  }

  private buildAreaSummary(regions: SetupRegion[], metros: SetupMetro[]) {
    const uniqueRegions = new Set(regions.map((item) => `${item.countryCode}:${item.regionLabel}`));
    if (metros.length) return `${uniqueRegions.size} regions · ${metros.length} city/metro targets`;
    return `${uniqueRegions.size} regions`;
  }

  private coverageFor(lane: ServiceType) {
    return lane === 'revenue'
      ? ['lead_generation', 'outreach', 'follow_up', 'meeting_booking', 'billing_collections']
      : ['lead_generation', 'outreach', 'follow_up', 'meeting_booking'];
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }

  private readStructuredScope(value: unknown): ScopeJson {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return this.buildScopeJson({
        lane: 'opportunity',
        mode: 'focused',
        countries: [],
        regions: [],
        metros: [],
        industries: [],
        includeGeo: [],
        excludeGeo: [],
        priorityMarkets: [],
        notes: null,
      });
    }

    const record = value as Record<string, unknown>;
    const lane = this.normalizeServiceType(this.readString(record.lane) ?? 'opportunity');
    const mode = this.normalizeScopeMode(this.readString(record.mode) ?? 'focused');
    const countries = this.tryReadCountries(record.countries);
    const regions = this.tryReadRegions(record.regions);
    const metros = this.tryReadMetros(record.metros);
    const industries = this.tryReadIndustries(record.industries);

    return {
      version: 2,
      lane,
      mode,
      coverage: Array.isArray(record.coverage)
        ? record.coverage.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : this.coverageFor(lane),
      countries,
      regions,
      metros,
      industries,
      includeGeo: Array.isArray(record.includeGeo)
        ? this.normalizeStringList(record.includeGeo as string[], 40, 120)
        : [],
      excludeGeo: Array.isArray(record.excludeGeo)
        ? this.normalizeStringList(record.excludeGeo as string[], 40, 120)
        : [],
      priorityMarkets: Array.isArray(record.priorityMarkets)
        ? this.normalizeStringList(record.priorityMarkets as string[], 20, 120)
        : [],
      notes: this.normalizeOptionalString(this.readString(record.notes) ?? undefined, 500),
      recommendedPlan: {
        lane,
        tier: mode,
        code: lane,
      },
    };
  }

  private tryReadCountries(value: unknown): SetupCountry[] {
    if (!Array.isArray(value)) return [];
    const countries: SetupCountry[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const record = this.asObject(item);
      const code = this.readString(record.code)?.toUpperCase();
      const label = this.readString(record.label);
      if (!code || !label || seen.has(code)) continue;
      seen.add(code);
      countries.push({ code, label });
    }
    return countries;
  }

  private tryReadRegions(value: unknown): SetupRegion[] {
    if (!Array.isArray(value)) return [];
    const regions: SetupRegion[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const record = this.asObject(item);
      const countryCode = this.readString(record.countryCode)?.toUpperCase();
      const countryLabel = this.readString(record.countryLabel);
      const regionType = this.readString(record.regionType);
      const regionCode = this.readString(record.regionCode);
      const regionLabel = this.readString(record.regionLabel);
      const key = `${countryCode}:${regionCode}`;
      if (!countryCode || !countryLabel || !regionType || !regionCode || !regionLabel || seen.has(key)) continue;
      seen.add(key);
      regions.push({ countryCode, countryLabel, regionType, regionCode, regionLabel });
    }
    return regions;
  }

  private tryReadMetros(value: unknown): SetupMetro[] {
    if (!Array.isArray(value)) return [];
    const metros: SetupMetro[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const record = this.asObject(item);
      const countryCode = this.readString(record.countryCode)?.toUpperCase();
      const regionCode = this.readString(record.regionCode);
      const label = this.readString(record.label);
      const key = `${countryCode}:${regionCode}:${label?.toLowerCase()}`;
      if (!countryCode || !regionCode || !label || seen.has(key)) continue;
      seen.add(key);
      metros.push({ countryCode, regionCode, label });
    }
    return metros;
  }

  private tryReadIndustries(value: unknown): SetupIndustry[] {
    if (!Array.isArray(value)) return [];
    const industries: SetupIndustry[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const record = this.asObject(item);
      const code = this.readString(record.code);
      const label = this.readString(record.label);
      if (!code || !label || seen.has(code)) continue;
      seen.add(code);
      industries.push({ code, label });
    }
    return industries;
  }


  private readPositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }

  private async resolveCommercialState(clientId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        clientId,
        status: {
          in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { code: true, name: true } } },
    });

    if (!subscription) {
      return {
        status: 'none',
        service: null as ServiceType | null,
        tier: null as ScopeMode | null,
        planCode: null,
        planName: null,
      };
    }

    const planCode = subscription.plan?.code ?? null;
    const normalizedPlanCode = typeof planCode === 'string' ? planCode.trim().toUpperCase() : '';

    const service: ServiceType | null = normalizedPlanCode.includes('REVENUE')
      ? 'revenue'
      : normalizedPlanCode.includes('OPPORTUNITY')
        ? 'opportunity'
        : null;

    const tier: ScopeMode | null = normalizedPlanCode.includes('PRECISION')
      ? 'precision'
      : normalizedPlanCode.includes('MULTI')
        ? 'multi'
        : normalizedPlanCode.includes('FOCUSED')
          ? 'focused'
          : null;

    return {
      status: subscription.status.toString(),
      service,
      tier,
      planCode,
      planName: subscription.plan?.name ?? null,
    };
  }
}
