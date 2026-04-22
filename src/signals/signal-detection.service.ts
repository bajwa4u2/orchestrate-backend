import { Injectable, NotFoundException } from '@nestjs/common';
import { SignalEvent } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { NormalizedSignal } from './signals.types';

@Injectable()
export class SignalDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  async detectForCampaign(input: { campaignId: string; organizationId?: string }) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      },
      include: { client: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const opportunity = await this.prisma.opportunityProfile.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!opportunity) {
      throw new NotFoundException('Opportunity profile missing. Generate strategy first.');
    }

    const strategy = this.asObject(opportunity.strategyJson);
    const signalPriorities = this.readStringArray(strategy.signalPriorities);
    const geographyScope = this.asObject(opportunity.geographyScope);
    const geoLabel =
      [
        ...this.readStringArray(geographyScope.cities),
        ...this.readStringArray(geographyScope.regions),
        ...this.readStringArray(geographyScope.countries),
      ].join(', ') || null;

    const signals: NormalizedSignal[] = signalPriorities.slice(0, 4).map((signalType, index) => ({
      signalType,
      signalSourceType: index % 2 === 0 ? 'PUBLIC_WEB' : 'DIRECTORY_TRIGGER',
      sourceUrlOrKey: `signal:${campaign.id}:${signalType.toLowerCase()}`,
      headlineOrLabel: `${signalType.replace(/_/g, ' ')} for ${campaign.name}`,
      geography: geoLabel ?? undefined,
      recencyScore: Math.max(65, 90 - index * 5),
      confidenceScore: Math.max(60, 88 - index * 6),
      payloadJson: {
        campaignName: campaign.name,
        objective: campaign.objective,
        offerSummary: campaign.offerSummary,
      },
      normalizedJson: {
        signalType,
        opportunityType: opportunity.opportunityType,
        geographyScope,
      },
    }));

    const created: SignalEvent[] = [];

    for (const signal of signals) {
      const createdSignal = await this.prisma.signalEvent.create({
        data: {
          organizationId: campaign.organizationId,
          clientId: campaign.clientId,
          campaignId: campaign.id,
          opportunityProfileId: opportunity.id,
          signalType: signal.signalType,
          signalSourceType: signal.signalSourceType,
          sourceUrlOrKey: signal.sourceUrlOrKey,
          headlineOrLabel: signal.headlineOrLabel,
          geography: signal.geography ?? null,
          recencyScore: signal.recencyScore,
          confidenceScore: signal.confidenceScore,
          payloadJson: toPrismaJson(signal.payloadJson),
          normalizedJson: toPrismaJson(signal.normalizedJson),
        },
      });

      created.push(createdSignal);
    }

    return {
      campaignId: campaign.id,
      opportunityProfileId: opportunity.id,
      items: created,
    };
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
}