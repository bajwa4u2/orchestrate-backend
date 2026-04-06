import { Injectable } from '@nestjs/common';
import { AgreementStatus } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { CreateServiceAgreementDto } from './dto/create-service-agreement.dto';

@Injectable()
export class AgreementsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.serviceAgreement.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, subscription: true, documentDispatches: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async create(organizationId: string, createdById: string | undefined, dto: CreateServiceAgreementDto) {
    const count = await this.prisma.serviceAgreement.count({ where: { organizationId } });
    return this.prisma.serviceAgreement.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        subscriptionId: dto.subscriptionId,
        createdById,
        agreementNumber: dto.agreementNumber ?? `AGR-${String(count + 1).padStart(5, '0')}`,
        title: dto.title || 'Orchestrate Service Agreement',
        status: dto.status ?? AgreementStatus.DRAFT,
        effectiveStartAt: dto.effectiveStartAt,
        effectiveEndAt: dto.effectiveEndAt,
        termsText: dto.termsText,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
      include: { client: true, subscription: true },
    });
  }
}
