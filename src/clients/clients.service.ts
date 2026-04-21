import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CampaignStatus, JobStatus, JobType, LeadStatus, Prisma, SubscriptionStatus } from '@prisma/client';
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

const CURRENT_REPRESENTATION_AUTH_VERSION = 1;

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
    const subscriptionAlignment = this.buildSubscriptionAlignment(commercial, scope);
    const campaign = await this.findPrimaryCampaignSnapshot(client.organizationId, client.id);
    const campaignHealth = campaign
      ? await this.buildCampaignHealthSnapshot(client.organizationId, client.id, campaign)
      : null;

    return {
      success: true,
      clientId: client.id,
      organizationId: client.organizationId,
      status: campaign?.status.toLowerCase() ?? 'ready',
      generationState: campaign?.generationState ?? null,
      bootstrapStatus: campaign?.activation.bootstrapStatus ?? null,
      jobId: campaign?.activation.jobId ?? null,
      campaign,
      health: campaignHealth?.health ?? null,
      metrics: campaignHealth?.metrics ?? null,
      governor: campaignHealth?.governor ?? null,
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
        subscriptionAlignment,
        generationState: campaign?.generationState ?? null,
        metadataJson: campaign?.metadataJson ?? null,
        activation: campaign?.activation ?? null,
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


  async acceptRepresentationAuth(headers: Record<string, unknown>) {
    const client = await this.resolveClientForRequest(headers);
    const context = await this.accessContextService.buildFromHeaders(headers);

    const existing = await this.prisma.clientRepresentationAuth.findUnique({
      where: {
        clientId_version: {
          clientId: client.id,
          version: CURRENT_REPRESENTATION_AUTH_VERSION,
        },
      },
    });

    if (existing) {
      return {
        success: true,
        status: 'representation_auth_already_recorded',
        clientId: client.id,
        organizationId: client.organizationId,
        version: CURRENT_REPRESENTATION_AUTH_VERSION,
        acceptedAt: existing.acceptedAt,
      };
    }

    const created = await this.prisma.clientRepresentationAuth.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        version: CURRENT_REPRESENTATION_AUTH_VERSION,
        acceptedByUserId: context.userId ?? null,
        acceptedByName: this.readString((context as any).userName) ?? client.displayName ?? client.legalName ?? null,
        acceptedByEmail: this.readString((context as any).userEmail) ?? client.primaryEmail ?? null,
        acceptedAt: new Date(),
        metadataJson: toPrismaJson({
          source: 'client_campaign_restart_gate',
          acceptedFromSurface: context.surface ?? 'client',
        }),
      },
    });

    return {
      success: true,
      status: 'representation_auth_recorded',
      clientId: client.id,
      organizationId: client.organizationId,
      version: CURRENT_REPRESENTATION_AUTH_VERSION,
      acceptedAt: created.acceptedAt,
    };
  }

  private async ensureRepresentationAuth(client: any) {
    const existing = await this.prisma.clientRepresentationAuth.findUnique({
      where: {
        clientId_version: {
          clientId: client.id,
          version: CURRENT_REPRESENTATION_AUTH_VERSION,
        },
      },
    });

    if (existing) {
      return null;
    }

    return {
      success: false,
      status: 'representation_auth_required',
      code: 'REPRESENTATION_AUTH_REQUIRED',
      clientId: client.id,
      organizationId: client.organizationId,
      campaignId: null,
      jobId: null,
      representationAuth: {
        required: true,
        version: CURRENT_REPRESENTATION_AUTH_VERSION,
      },
      message:
        'Before Orchestrate can start outreach on your behalf, you need to authorize representation for your business.',
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
      };
    }

    const representationAuthRequired = await this.ensureRepresentationAuth(client);
    if (representationAuthRequired) {
      return representationAuthRequired;
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

    if (effectiveLane != scope.lane) {
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

    let campaign = await this.prisma.campaign.findFirst({
      where: {
        organizationId: client.organizationId,
        clientId: client.id,
        code: 'PRIMARY_AUTOMATION',
      },
      orderBy: [{ updatedAt: 'desc' }],
      select: { id: true, status: true },
    });

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

      campaign = { id: created.id, status: created.status };
    } else {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          objective: this.buildCampaignObjective(effectiveScope),
          offerSummary: this.buildCampaignOfferSummary(effectiveScope),
          bookingUrlOverride: client.bookingUrl ?? null,
          timezone: client.primaryTimezone ?? null,
          metadataJson: toPrismaJson({
            ...this.asObject((await this.prisma.campaign.findUnique({
              where: { id: campaign.id },
              select: { metadataJson: true },
            }))?.metadataJson),
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
          }),
        },
      });
    }

    const activation = await this.campaignsService.activateCampaign({
      campaignId: campaign.id,      
    });

    const cooldownStampSource = await this.prisma.campaign.findUnique({
      where: { id: campaign.id },
      select: { metadataJson: true },
    });

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        metadataJson: toPrismaJson({
          ...this.asObject(cooldownStampSource?.metadataJson),
          governor: {
            ...this.asObject(this.asObject(cooldownStampSource?.metadataJson).governor),
            status: 'healthy',
            reason: null,
            note: null,
            lastManualRestartAt: new Date().toISOString(),
            lastManualRestartBy: 'client',
          },
        }),
      },
    });

    const refreshedCampaign = await this.findPrimaryCampaignSnapshot(client.organizationId, client.id);
    const campaignHealth = refreshedCampaign
      ? await this.buildCampaignHealthSnapshot(client.organizationId, client.id, refreshedCampaign)
      : null;

    return {
      success: true,
      status: typeof activation.status === 'string' ? activation.status : 'activating',
      clientId: client.id,
      organizationId: client.organizationId,
      campaignId: campaign.id,
      jobId: 
        ('jobId' in activation ? activation.jobId : null) ??
        refreshedCampaign?.activation?.jobId ?? 
        null,
      alreadyActive:
        Boolean((activation as any).alreadyActive) ||
        (typeof activation.status === 'string' && activation.status.toLowerCase() == 'active'),
      generationState: refreshedCampaign?.generationState ?? (activation.generationState ?? null),
      bootstrapStatus:
        refreshedCampaign?.activation.bootstrapStatus ??
        (typeof activation.bootstrapStatus === 'string' ? activation.bootstrapStatus : null),
      message:
        typeof activation.message === 'string' && activation.message.trim().length
          ? activation.message
          : Boolean((activation as any).alreadyActive)
            ? 'Your campaign is already running.'
            : 'Your campaign activation has started. We are preparing leads now.',
      campaign: refreshedCampaign,
      health: campaignHealth?.health ?? null,
      metrics: campaignHealth?.metrics ?? null,
      campaignProfile: {
        serviceType: effectiveScope.lane,
        scopeMode: effectiveScope.mode,
        countries: effectiveScope.countries,
        regions: effectiveScope.regions,
        metros: effectiveScope.metros,
        industries: effectiveScope.industries,
        includeGeo: effectiveScope.includeGeo,
        excludeGeo: effectiveScope.excludeGeo,
        priorityMarkets: effectiveScope.priorityMarkets,
        notes: effectiveScope.notes,
        recommendedPlan: effectiveScope.recommendedPlan,
        subscriptionAlignment,
        generationState:
          refreshedCampaign?.generationState ?? (activation.generationState ?? null),
        metadataJson: refreshedCampaign?.metadataJson ?? null,
        activation: refreshedCampaign?.activation ?? null,
      },
    };
  }


  async restartCampaign(headers: Record<string, unknown>) {
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
        message: 'Activate a valid subscription before restarting this campaign.',
        campaignId: null,
        jobId: null,
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
      };
    }

    const representationAuthRequired = await this.ensureRepresentationAuth(client);
    if (representationAuthRequired) {
      return representationAuthRequired;
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

    if (effectiveLane != scope.lane) {
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

    let campaign = await this.prisma.campaign.findFirst({
      where: {
        organizationId: client.organizationId,
        clientId: client.id,
        code: 'PRIMARY_AUTOMATION',
      },
      orderBy: [{ updatedAt: 'desc' }],
      select: { id: true, status: true, metadataJson: true },
    });

    if (!campaign) {
      return this.startCampaign(headers);
    }

    const currentCampaignMetadata = this.asObject(campaign.metadataJson);
    const governor = this.asObject(currentCampaignMetadata.governor);
    const governorStatus = this.readString(governor.status)?.toLowerCase() ?? null;
    const governorReason = this.readString(governor.reason)?.toLowerCase() ?? null;
    const restartCooldownHours = Math.max(1, Math.min(this.readPositiveInt(governor.restartCooldownHours) ?? 6, 168));
    const lastManualRestartAt = this.readString(governor.lastManualRestartAt);

    if (
      governorStatus === 'paused_by_governor' &&
      ['duration_limit_reached', 'lifetime_lead_cap_reached', 'lifetime_send_cap_reached'].includes(governorReason ?? '')
    ) {
      return {
        success: false,
        status: 'governor_locked',
        clientId: client.id,
        organizationId: client.organizationId,
        campaignId: campaign.id,
        jobId: null,
        message: 'This campaign was paused by safety limits. Review the campaign limits before restarting.',
      };
    }

    if (lastManualRestartAt) {
      const lastRestartTime = new Date(lastManualRestartAt);
      const cooldownEndsAt = new Date(lastRestartTime.getTime() + restartCooldownHours * 60 * 60 * 1000);
      if (cooldownEndsAt.getTime() > Date.now()) {
        return {
          success: false,
          status: 'restart_cooldown',
          clientId: client.id,
          organizationId: client.organizationId,
          campaignId: campaign.id,
          jobId: null,
          message: `Please wait before restarting again. Restart cooldown is ${restartCooldownHours} hour(s).`,
        };
      }
    }

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        objective: this.buildCampaignObjective(effectiveScope),
        offerSummary: this.buildCampaignOfferSummary(effectiveScope),
        bookingUrlOverride: client.bookingUrl ?? null,
        timezone: client.primaryTimezone ?? null,
        metadataJson: toPrismaJson({
          ...this.asObject(campaign.metadataJson),
          source: 'client_campaign_restart',
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
          governor: {
            ...this.asObject(this.asObject(campaign.metadataJson).governor),
            status: 'healthy',
            reason: null,
            note: null,
          },
        }),
      },
    });

    const activation = await this.campaignsService.restartCampaign({
      campaignId: campaign.id,
      organizationId: client.organizationId,
    });

    const refreshedCampaign = await this.findPrimaryCampaignSnapshot(client.organizationId, client.id);
    const campaignHealth = refreshedCampaign
      ? await this.buildCampaignHealthSnapshot(client.organizationId, client.id, refreshedCampaign)
      : null;

    return {
      success: true,
      status: typeof activation.status === 'string' ? activation.status : 'activating',
      clientId: client.id,
      organizationId: client.organizationId,
      campaignId: campaign.id,
      jobId: 
        ('jobId' in activation ? activation.jobId : null) ??
        refreshedCampaign?.activation?.jobId ?? 
        null,
      generationState: refreshedCampaign?.generationState ?? (activation.generationState ?? null),
      bootstrapStatus:
        refreshedCampaign?.activation.bootstrapStatus ??
        (typeof activation.bootstrapStatus === 'string' ? activation.bootstrapStatus : null),
      message:
        typeof activation.message === 'string' && activation.message.trim().length
          ? activation.message
          : 'Campaign restart has started. We are applying your updated targeting now.',
      campaign: refreshedCampaign,
      health: campaignHealth?.health ?? null,
      metrics: campaignHealth?.metrics ?? null,
      campaignProfile: {
        serviceType: effectiveScope.lane,
        scopeMode: effectiveScope.mode,
        countries: effectiveScope.countries,
        regions: effectiveScope.regions,
        metros: effectiveScope.metros,
        industries: effectiveScope.industries,
        includeGeo: effectiveScope.includeGeo,
        excludeGeo: effectiveScope.excludeGeo,
        priorityMarkets: effectiveScope.priorityMarkets,
        notes: effectiveScope.notes,
        recommendedPlan: effectiveScope.recommendedPlan,
        subscriptionAlignment,
        generationState:
          refreshedCampaign?.generationState ?? (activation.generationState ?? null),
        metadataJson: refreshedCampaign?.metadataJson ?? null,
        activation: refreshedCampaign?.activation ?? null,
      },
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
  private async buildCampaignHealthSnapshot(
    organizationId: string,
    clientId: string,
    campaign: {
      id: string;
      status: string;
      activation?: { bootstrapStatus?: string | null } | null;
    },
  ) {
    const sendableStatuses = [LeadStatus.NEW, LeadStatus.ENRICHED, LeadStatus.QUALIFIED];
    const activeJobStatuses = [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRY_SCHEDULED];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [sendable, queued, sentToday, replies, meetings, campaignRecord, activeLeadImportJobs] = await Promise.all([
      this.prisma.lead.count({
        where: {
          organizationId,
          clientId,
          campaignId: campaign.id,
          status: { in: sendableStatuses },
          contact: { is: { email: { not: null } } },
        },
      }),
      this.prisma.job.count({
        where: {
          organizationId,
          clientId,
          campaignId: campaign.id,
          type: JobType.FIRST_SEND,
          status: { in: activeJobStatuses },
        },
      }),
      this.prisma.job.count({
        where: {
          organizationId,
          clientId,
          campaignId: campaign.id,
          type: JobType.FIRST_SEND,
          status: JobStatus.SUCCEEDED,
          finishedAt: { gte: startOfToday },
        },
      }),
      this.prisma.reply.count({
        where: {
          organizationId,
          clientId,
          campaignId: campaign.id,
        },
      }),
      this.prisma.meeting.count({
        where: {
          organizationId,
          clientId,
          campaignId: campaign.id,
        },
      }),
      this.prisma.campaign.findUnique({
        where: { id: campaign.id },
        select: { dailySendCap: true, status: true, metadataJson: true },
      }),
      this.prisma.job.count({
        where: {
          organizationId,
          clientId,
          campaignId: campaign.id,
          type: JobType.LEAD_IMPORT,
          status: { in: activeJobStatuses },
        },
      }),
    ]);

    const dailySendCap = campaignRecord?.dailySendCap ?? 30;
    const normalizedStatus = campaignRecord?.status ?? campaign.status;
    const bootstrapStatus = this.readString(campaign.activation?.bootstrapStatus)?.toLowerCase() ?? '';
    const governor = this.asObject(this.asObject(campaignRecord?.metadataJson).governor);

    let health = 'ACTIVE';

    if (normalizedStatus === CampaignStatus.PAUSED) {
      health = 'PAUSED';
    } else if (
      bootstrapStatus == 'activation_requested' ||
      bootstrapStatus == 'activation_in_progress' ||
      activeLeadImportJobs > 0
    ) {
      health = 'REFILLING';
    } else if (sendable == 0 && queued == 0) {
      health = 'REFILLING';
    } else if (sendable < 5 && queued == 0) {
      health = 'STALLED';
    } else if (queued >= dailySendCap) {
      health = 'SATURATED';
    } else if (sendable < 10) {
      health = 'REFILLING';
    }

    return {
      health,
      metrics: {
        sendable,
        queued,
        sentToday,
        replies,
        meetings,
        dailySendCap,
      },
      governor: {
        enabled: typeof governor.enabled === 'boolean' ? governor.enabled : true,
        status: this.readString(governor.status),
        reason: this.readString(governor.reason),
        note: this.readString(governor.note),
        pausedAt: this.readString(governor.pausedAt),
        lastCheckedAt: this.readString(governor.lastCheckedAt),
        restartCooldownHours: this.readPositiveInt(governor.restartCooldownHours),
        maxDurationDays: this.readPositiveInt(governor.maxDurationDays),
        maxLifetimeLeads: this.readPositiveInt(governor.maxLifetimeLeads),
        maxLifetimeSends: this.readPositiveInt(governor.maxLifetimeSends),
        totals: this.asObject(governor.totals),
      },
    };
  }

  private async findPrimaryCampaignSnapshot(organizationId: string, clientId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        organizationId,
        clientId,
        code: 'PRIMARY_AUTOMATION',
      },
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        generationState: true,
        metadataJson: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    if (!campaign) {
      return null;
    }

    const metadata = this.asObject(campaign.metadataJson);
    const activation = this.asObject(metadata.activation);

    return {
      id: campaign.id,
      code: campaign.code,
      name: campaign.name,
      status: campaign.status,
      generationState: campaign.generationState,
      metadataJson: metadata,
      activation: {
        version: this.readPositiveInt(activation.version),
        bootstrapStatus: this.readString(activation.bootstrapStatus),
        requestedAt: this.readString(activation.requestedAt),
        completedAt: this.readString(activation.completedAt),
        failedAt: this.readString(activation.failedAt),
        retryAt: this.readString(activation.retryAt),
        lastError: this.readString(activation.lastError),
        dedupeKey: this.readString(activation.dedupeKey),
        jobId: this.readString(activation.jobId),
      },
      updatedAt: campaign.updatedAt,
      createdAt: campaign.createdAt,
    };
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
