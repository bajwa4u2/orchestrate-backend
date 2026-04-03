import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

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
}
