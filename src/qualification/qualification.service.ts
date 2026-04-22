import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { policyService } from '../common/policy/data-policy';

@Injectable()
export class QualificationService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateEntity(input: { entityId: string; organizationId?: string }) {
    const entity = await this.prisma.discoveredEntity.findFirst({
      where: { id: input.entityId, ...(input.organizationId ? { organizationId: input.organizationId } : {}) },
    });
    if (!entity) throw new NotFoundException('Discovered entity not found');

    const reachability = await this.prisma.reachabilityRecord.findFirst({
      where: { discoveredEntityId: entity.id },
      orderBy: { createdAt: 'desc' },
    });

    const executionPolicy = policyService.evaluateExecution({
      email: reachability?.emailCandidate,
      companyName: entity.companyName,
      domain: reachability?.domain ?? entity.domain,
    });

    const relevanceScore = Math.max(45, Number(entity.entityConfidence ?? 60));
    const timelinessScore = entity.status === 'DISCOVERED' ? 78 : 62;
    const reachabilityScore = executionPolicy.status === 'BLOCKED'
      ? 5
      : Number(reachability?.reachabilityScore ?? 25);
    const valueScore = entity.personName ? 74 : 60;
    const finalScore = Math.round(
      relevanceScore * 0.35 +
        timelinessScore * 0.2 +
        reachabilityScore * 0.3 +
        valueScore * 0.15,
    );

    const decision =
      executionPolicy.status === 'BLOCKED'
        ? 'DISCARD'
        : finalScore >= 70
          ? 'ACCEPT'
          : finalScore >= 55
            ? 'HOLD'
            : 'DISCARD';

    const record = await this.prisma.qualificationDecision.create({
      data: {
        organizationId: entity.organizationId,
        clientId: entity.clientId,
        campaignId: entity.campaignId,
        discoveredEntityId: entity.id,
        opportunityProfileId: entity.opportunityProfileId,
        decision,
        relevanceScore,
        timelinessScore,
        reachabilityScore,
        valueScore,
        finalScore,
        reasonJson: toPrismaJson({
          hasDirectPerson: Boolean(entity.personName),
          hasEmailCandidate: Boolean(reachability?.emailCandidate),
          inferredRole: entity.inferredRole,
          executionPolicy,
        }),
      },
    });

    return { entity, reachability, qualification: record, policy: executionPolicy };
  }
}
