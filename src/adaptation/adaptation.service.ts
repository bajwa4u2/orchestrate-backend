import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';

@Injectable()
export class AdaptationService {
  constructor(private readonly prisma: PrismaService) {}

  async runForCampaign(input: { campaignId: string; organizationId?: string }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, ...(input.organizationId ? { organizationId: input.organizationId } : {}) },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const [entityCount, reachableCount, acceptedCount] = await Promise.all([
      this.prisma.discoveredEntity.count({ where: { campaignId: campaign.id } }),
      this.prisma.reachabilityRecord.count({ where: { campaignId: campaign.id, emailCandidate: { not: null } } }),
      this.prisma.qualificationDecision.count({ where: { campaignId: campaign.id, decision: 'ACCEPT' } }),
    ]);

    let triggerType = 'NO_ADAPTATION_NEEDED';
    let reason = 'Current sourcing path is adequate.';
    let newPath = { sourceOrder: ['SEARCH', 'DIRECTORY', 'WEBSITE', 'OPEN_DATA'] } as Record<string, unknown>;

    if (!entityCount) {
      triggerType = 'ZERO_DISCOVERED_ENTITIES';
      reason = 'No entities were discovered. Retry with broader signal coverage.';
      newPath = { sourceOrder: ['DIRECTORY', 'SEARCH', 'WEBSITE', 'OPEN_DATA'], widenGeography: true };
    } else if (!reachableCount) {
      triggerType = 'LOW_REACHABLE_RATE';
      reason = 'Entities exist but no reachability path is usable. Move website-first.';
      newPath = { sourceOrder: ['WEBSITE', 'SEARCH', 'DIRECTORY', 'OPEN_DATA'], retryRoleTargeting: true };
    } else if (!acceptedCount) {
      triggerType = 'LOW_ACCEPTED_RATE';
      reason = 'Reachable entities are failing qualification. Tighten opportunity reasoning and widen signal classes.';
      newPath = { sourceOrder: ['SEARCH', 'WEBSITE', 'DIRECTORY', 'OPEN_DATA'], widenSignalClasses: true };
    }

    const record = await this.prisma.adaptationDecision.create({
      data: {
        organizationId: campaign.organizationId,
        clientId: campaign.clientId,
        campaignId: campaign.id,
        triggerType,
        previousPathJson: toPrismaJson({ entityCount, reachableCount, acceptedCount }),
        newPathJson: toPrismaJson(newPath),
        reason,
      },
    });

    return { campaignId: campaign.id, entityCount, reachableCount, acceptedCount, adaptation: record };
  }
}
