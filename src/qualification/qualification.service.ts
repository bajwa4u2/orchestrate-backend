import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';

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

    const reachabilityNotes = this.asObject(reachability?.notesJson);
    const contactPolicyStatus = this.readString(reachabilityNotes.contactPolicyStatus) ?? 'BLOCKED';
    const sourceEvidence = this.asObject(entity.sourceEvidenceJson);
    const sourcePolicyStatus = this.readString(sourceEvidence.sourcePolicyStatus) ?? 'BLOCKED';

    const relevanceScore = Math.max(45, Number(entity.entityConfidence ?? 60));
    const timelinessScore = entity.status === 'DISCOVERED' ? 78 : 62;
    const reachabilityScore = Number(reachability?.reachabilityScore ?? 25);
    const valueScore = entity.personName ? 74 : 60;
    const policyPenalty =
      sourcePolicyStatus === 'BLOCKED' || contactPolicyStatus === 'BLOCKED'
        ? 35
        : contactPolicyStatus === 'REVIEW_REQUIRED'
        ? 10
        : 0;

    const weightedScore = Math.round((relevanceScore * 0.35) + (timelinessScore * 0.2) + (reachabilityScore * 0.3) + (valueScore * 0.15));
    const finalScore = Math.max(0, weightedScore - policyPenalty);

    const decision =
      sourcePolicyStatus === 'BLOCKED' || contactPolicyStatus === 'BLOCKED'
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
          sourcePolicyStatus,
          contactPolicyStatus,
          policyPenalty,
        }),
      },
    });

    return { entity, reachability, qualification: record };
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : null;
  }
}
