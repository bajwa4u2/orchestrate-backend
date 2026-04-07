import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { buildPagination } from '../common/utils/pagination';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientSetupDto } from './dto/create-client-setup.dto';
import { ListClientsDto } from './dto/list-clients.dto';

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

    return {
      clientId: client.id,
      organizationId: client.organizationId,
      emailVerified: true,
      setupCompleted: Boolean(client.setupCompletedAt),
      setupCompletedAt: client.setupCompletedAt,
      selectedPlan: client.selectedPlan,
      subscriptionStatus: await this.resolveSubscriptionStatus(client.id),
      setup: client.setupCompletedAt
        ? {
            country: client.country,
            area: client.area,
            industry: client.industry,
            scope: this.readScope(client.scopeJson),
          }
        : null,
    };
  }

  async saveSetup(headers: Record<string, unknown>, dto: CreateClientSetupDto) {
    const client = await this.resolveClientForRequest(headers);

    const country = dto.country.trim();
    const area = dto.area.trim();
    const industry = dto.industry.trim();
    const normalizedScope = dto.scope
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (!country.length) {
      throw new BadRequestException('Country is required');
    }
    if (!area.length) {
      throw new BadRequestException('Target area is required');
    }
    if (!industry.length) {
      throw new BadRequestException('Industry is required');
    }
    if (!normalizedScope.length) {
      throw new BadRequestException('Select at least one scope');
    }

    const selectedPlan =
      typeof dto.selectedPlan === 'string' && dto.selectedPlan.trim().length > 0
        ? dto.selectedPlan.trim()
        : client.selectedPlan;

    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: {
        country,
        area,
        industry,
        scopeJson: toPrismaJson(normalizedScope),
        selectedPlan,
        setupCompletedAt: new Date(),
      },
    });

    const subscriptionStatus = await this.resolveSubscriptionStatus(updated.id);
    const nextRoute =
      selectedPlan && selectedPlan.length > 0
        ? `/client/subscribe?plan=${selectedPlan}`
        : '/client/workspace';

    return {
      success: true,
      client: {
        clientId: updated.id,
        organizationId: updated.organizationId,
        emailVerified: true,
        setupCompleted: true,
        setupCompletedAt: updated.setupCompletedAt,
        selectedPlan: updated.selectedPlan,
        subscriptionStatus,
        setup: {
          country: updated.country,
          area: updated.area,
          industry: updated.industry,
          scope: this.readScope(updated.scopeJson),
        },
      },
      nextRoute,
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

    return subscription?.status ?? 'none';
  }
}
