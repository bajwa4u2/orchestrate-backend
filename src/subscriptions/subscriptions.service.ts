import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type ClientCapability =
  | 'campaigns.read'
  | 'campaigns.write'
  | 'leads.read'
  | 'leads.write'
  | 'execution.queue';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.subscription.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { plan: true, client: true, invoices: true, serviceAgreements: true },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async getClientEntitlement(organizationId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId,
        archivedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
        selectedPlan: true,
        setupCompletedAt: true,
        metadataJson: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: { select: { code: true, name: true } } },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client account not found in the active organization');
    }

    const metadata = this.asObject(client.metadataJson);
    const account = this.asObject(metadata.account);
    const deactivatedAt = this.readString(account.deactivatedAt);
    const subscription = client.subscriptions[0] ?? null;
    const subscriptionStatus = subscription?.status ?? null;

    const reasons: string[] = [];
    if (client.status !== 'ACTIVE') reasons.push(`client_status_${client.status.toLowerCase()}`);
    if (deactivatedAt) reasons.push('client_deactivated');
    if (!client.setupCompletedAt) reasons.push('setup_incomplete');
    if (!client.selectedPlan) reasons.push('plan_unselected');
    if (!subscriptionStatus) reasons.push('subscription_missing');
    if (
      subscriptionStatus &&
      ![
        SubscriptionStatus.TRIALING, 
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAUSED,
      ].includes(subscriptionStatus as any)
    ) {
      reasons.push(`subscription_${subscriptionStatus.toLowerCase()}`);
    }

    return {
      allowed: reasons.length === 0,
      clientId: client.id,
      organizationId: client.organizationId,
      selectedPlan: client.selectedPlan ?? null,
      setupCompletedAt: client.setupCompletedAt?.toISOString() ?? null,
      subscriptionStatus: subscriptionStatus?.toString().toLowerCase() ?? 'none',
      subscriptionId: subscription?.id ?? null,
      planCode: subscription?.plan?.code ?? null,
      planName: subscription?.plan?.name ?? null,
      reasons,
    };
  }

  async assertClientCapability(organizationId: string, clientId: string, capability: ClientCapability) {
    const entitlement = await this.getClientEntitlement(organizationId, clientId);
    if (!entitlement.allowed) {
      throw new ForbiddenException(
        `Access blocked for ${capability}: ${entitlement.reasons.join(', ') || 'entitlement_missing'}`,
      );
    }
    return entitlement;
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
  }
}
