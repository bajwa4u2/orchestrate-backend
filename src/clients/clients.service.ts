import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { buildPagination } from '../common/utils/pagination';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientSetupDto } from './dto/create-client-setup.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly prisma: PrismaService,
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
    const selectedPlan = this.readString(setup.selectedPlan) ?? client.selectedPlan;
    const subscriptionStatus = await this.resolveSubscriptionStatus(client.id);

    return {
      clientId: client.id,
      organizationId: client.organizationId,
      emailVerified: true,
      setupCompleted: Boolean(client.setupCompletedAt),
      setupCompletedAt: client.setupCompletedAt,
      selectedPlan,
      subscriptionStatus,
      setup: client.setupCompletedAt
        ? {
            countryCode: this.readString(setup.countryCode),
            countryName: this.readString(setup.countryName) ?? client.country,
            regionType: this.readString(setup.regionType),
            regionCode: this.readString(setup.regionCode),
            regionName: this.readString(setup.regionName),
            localityName: this.readString(setup.localityName),
            industryCode: this.readString(setup.industryCode),
            industryLabel: this.readString(setup.industryLabel) ?? client.industry,
            selectedPlan,
            scope: this.readScope(setup.scope ?? client.scopeJson),
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
    const countryCode = dto.countryCode.trim().toUpperCase();
    const countryName = dto.countryName.trim();
    const regionType = dto.regionType.trim();
    const regionCode = dto.regionCode.trim();
    const regionName = dto.regionName.trim();
    const localityName = dto.localityName?.trim() || null;
    const industryCode = dto.industryCode.trim();
    const industryLabel = dto.industryLabel.trim();
    const selectedPlan = dto.selectedPlan.trim().toLowerCase();
    const normalizedScope = this.scopeForPlan(selectedPlan);

    if (!countryCode.length || !countryName.length) {
      throw new BadRequestException('Country is required');
    }
    if (!regionType.length || !regionCode.length || !regionName.length) {
      throw new BadRequestException('Region is required');
    }
    if (!industryCode.length || !industryLabel.length) {
      throw new BadRequestException('Industry is required');
    }
    if (!selectedPlan.length) {
      throw new BadRequestException('Plan is required');
    }

    const metadata = this.asObject(client.metadataJson);
    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: {
        country: countryName,
        area: localityName != null && localityName.trim().length > 0
            ? `${regionName} · ${localityName}`
            : regionName,
        industry: industryLabel,
        scopeJson: normalizedScope as Prisma.InputJsonValue,
        selectedPlan,
        setupCompletedAt: new Date(),
        metadataJson: toPrismaJson({
          ...metadata,
          setup: {
            countryCode,
            countryName,
            regionType,
            regionCode,
            regionName,
            localityName,
            industryCode,
            industryLabel,
            selectedPlan,
            scope: normalizedScope,
          },
        }),
      },
    });

    const subscriptionStatus = await this.resolveSubscriptionStatus(updated.id);
    const normalizedStatus = subscriptionStatus.toLowerCase();
    const nextRoute = normalizedStatus === 'active'
      ? '/client/workspace'
      : `/client/subscribe?plan=${selectedPlan}`;

    return {
      success: true,
      client: {
        clientId: updated.id,
        organizationId: updated.organizationId,
        emailVerified: true,
        setupCompleted: true,
        setupCompletedAt: updated.setupCompletedAt,
        selectedPlan: updated.selectedPlan,
        subscriptionStatus: normalizedStatus,
        setup: {
          countryCode,
          countryName,
          regionType,
          regionCode,
          regionName,
          localityName,
          industryCode,
          industryLabel,
          selectedPlan,
          scope: normalizedScope,
        },
      },
      nextRoute,
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

    if (context.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: context.clientId },
      });
      if (client) {
        return client;
      }
    }

    if (context.organizationId) {
      const client = await this.prisma.client.findFirst({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: 'asc' },
      });
      if (client) {
        return client;
      }
    }

    throw new NotFoundException('Client account not found');
  }

  private scopeForPlan(plan: string) {
    const normalized = plan.trim().toLowerCase();
    if (normalized == 'revenue') {
      return ['lead_generation', 'outreach', 'follow_up', 'meeting_booking', 'billing_collections'];
    }
    return ['lead_generation', 'outreach', 'follow_up', 'meeting_booking'];
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

  private readScope(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }

  private async resolveSubscriptionStatus(clientId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });

    return (subscription?.status ?? 'none').toString();
  }
}
