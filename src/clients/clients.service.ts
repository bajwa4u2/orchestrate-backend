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
    private readonly prisma: PrismaService,
    private readonly accessContextService: AccessContextService,
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

  async getMySetup(headers: Record<string, unknown>) {
    const context = await this.accessContextService.buildFromHeaders(headers);
    if (!context.userId || context.surface !== 'client') {
      throw new UnauthorizedException('Client session is required');
    }

    const client = await this.resolveClientFromContext(context.userId, context.organizationId, context.clientId);
    const subscription = await this.prisma.subscription.findFirst({
      where: { clientId: client.id },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        amountCents: true,
        currencyCode: true,
      },
    });

    return {
      clientId: client.id,
      organizationId: client.organizationId,
      emailVerified: true,
      setupCompleted: Boolean(client.setupCompletedAt),
      setupCompletedAt: client.setupCompletedAt?.toISOString() ?? null,
      selectedPlan: client.selectedPlan ?? null,
      subscriptionStatus: subscription?.status?.toString().toLowerCase() ?? 'none',
      subscriptionAmount: subscription?.amountCents ?? null,
      subscriptionInterval: null,
      setup: client.setupCompletedAt
        ? {
            country: client.country ?? null,
            area: client.area ?? null,
            industry: client.industry ?? null,
            scope: Array.isArray(client.scopeJson)
              ? client.scopeJson.map((item) => String(item))
              : [],
          }
        : null,
    };
  }

  async saveMySetup(headers: Record<string, unknown>, dto: CreateClientSetupDto) {
    const context = await this.accessContextService.buildFromHeaders(headers);
    if (!context.userId || context.surface !== 'client') {
      throw new UnauthorizedException('Client session is required');
    }

    const client = await this.resolveClientFromContext(context.userId, context.organizationId, context.clientId);

    const normalizedScope = dto.scope
      .map((item) => item.trim())
      .filter((item) => item.isNotEmpty);

    if (!normalizedScope.length) {
      throw new BadRequestException('At least one scope is required');
    }

    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: {
        country: dto.country.trim(),
        area: dto.area.trim(),
        industry: dto.industry.trim(),
        scopeJson: normalizedScope,
        selectedPlan: dto.selectedPlan?.trim() || client.selectedPlan || null,
        setupCompletedAt: new Date(),
      },
    });

    const selectedPlan = updated.selectedPlan ?? null;
    const nextRoute = selectedPlan != null && selectedPlan.isNotEmpty
      ? `/client/subscribe?plan=${selectedPlan}`
      : '/client/workspace';

    return {
      success: true,
      client: {
        clientId: updated.id,
        emailVerified: true,
        setupCompleted: true,
        setupCompletedAt: updated.setupCompletedAt?.toISOString() ?? null,
        selectedPlan,
        subscriptionStatus: 'none',
        setup: {
          country: updated.country ?? null,
          area: updated.area ?? null,
          industry: updated.industry ?? null,
          scope: Array.isArray(updated.scopeJson)
            ? updated.scopeJson.map((item) => String(item))
            : [],
        },
      },
      nextRoute,
    };
  }

  private async resolveClientFromContext(
    userId: string,
    organizationId?: string,
    clientId?: string,
  ) {
    if (clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      if (!client) {
        throw new NotFoundException('Client account not found');
      }
      return client;
    }

    if (!organizationId) {
      throw new UnauthorizedException('Client organization context is missing');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const client = await this.prisma.client.findFirst({
      where: {
        organizationId,
        OR: user?.email
          ? [
              { primaryEmail: user.email },
              { billingEmail: user.email },
              { legalEmail: user.email },
              { opsEmail: user.email },
            ]
          : undefined,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!client) {
      throw new NotFoundException('Client account not found');
    }

    return client;
  }
}
