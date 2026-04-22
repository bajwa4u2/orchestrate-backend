import { Injectable } from '@nestjs/common';
import { DiscoveredEntity } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { policyService } from '../common/policy/data-policy';
import { SearchDiscoveryProvider } from './providers/internal/search.discovery-provider';
import { DirectoryDiscoveryProvider } from './providers/internal/directory.discovery-provider';
import { WebsiteDiscoveryProvider } from './providers/internal/website.discovery-provider';
import { DiscoveryCandidate } from './types/discovery.types';

@Injectable()
export class InternalDiscoveryOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchProvider: SearchDiscoveryProvider,
    private readonly directoryProvider: DirectoryDiscoveryProvider,
    private readonly websiteProvider: WebsiteDiscoveryProvider,
  ) {}

  async discover(input: {
    organizationId: string;
    clientId: string;
    campaignId: string;
    opportunityProfileId: string;
    sourcePlanId: string;
    campaignName: string;
    clientName: string;
    clientWebsiteUrl?: string | null;
    objective?: string | null;
    offerSummary?: string | null;
    industry?: string | null;
    geography: string[];
    seedProspects: Array<Record<string, unknown>>;
    limit: number;
  }) {
    const sourceRuns: Array<{ id: string; sourceType: string }> = [];

    const searchRun = await this.prisma.sourceRun.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        sourcePlanId: input.sourcePlanId,
        opportunityProfileId: input.opportunityProfileId,
        sourceType: 'SEARCH',
        status: 'RUNNING',
      },
    });
    sourceRuns.push({ id: searchRun.id, sourceType: 'SEARCH' });
    const searchCandidates = await this.searchProvider.discover({
      campaignName: input.campaignName,
      objective: input.objective,
      offerSummary: input.offerSummary,
      seedProspects: input.seedProspects,
      geography: input.geography,
      limit: input.limit,
    });
    await this.prisma.sourceRun.update({
      where: { id: searchRun.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), resultCount: searchCandidates.length },
    });

    const directoryRun = await this.prisma.sourceRun.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        campaignId: input.campaignId,
        sourcePlanId: input.sourcePlanId,
        opportunityProfileId: input.opportunityProfileId,
        sourceType: 'DIRECTORY',
        status: 'RUNNING',
      },
    });
    sourceRuns.push({ id: directoryRun.id, sourceType: 'DIRECTORY' });
    const directoryCandidates = await this.directoryProvider.discover({
      clientName: input.clientName,
      industry: input.industry,
      geography: input.geography,
      limit: Math.min(input.limit, 10),
    });
    await this.prisma.sourceRun.update({
      where: { id: directoryRun.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), resultCount: directoryCandidates.length },
    });

    const websiteCandidates = await this.websiteProvider.discover({
      clientWebsiteUrl: input.clientWebsiteUrl,
      existingCandidates: [...searchCandidates, ...directoryCandidates],
    });

    const allCandidates = this.uniqueCandidates([
      ...searchCandidates,
      ...directoryCandidates,
      ...websiteCandidates,
    ]).slice(0, input.limit);

    const created: DiscoveredEntity[] = [];

    for (const candidate of allCandidates) {
      const sourcePolicy = policyService.evaluateSource({
        sourceType: candidate.sourceType,
        domain: candidate.domain,
        websiteUrl: candidate.websiteUrl,
      });
      if (sourcePolicy.status === 'BLOCKED') {
        continue;
      }

      const entityPolicy = policyService.evaluateEntity({
        companyName: candidate.companyName,
        personName: candidate.personName,
        domain: candidate.domain,
        websiteUrl: candidate.websiteUrl,
      });
      if (entityPolicy.status === 'BLOCKED') {
        continue;
      }

      const matchingRun = sourceRuns.find((item) => item.sourceType === candidate.sourceType) ?? sourceRuns[0];
      const dedupeKey = `${candidate.companyName.toLowerCase()}|${(candidate.personName || '').toLowerCase()}|${(candidate.domain || '').toLowerCase()}`;
      const evidence = {
        ...(candidate.evidence && typeof candidate.evidence === 'object' ? candidate.evidence : {}),
        policy: {
          sourceStatus: sourcePolicy.status,
          sourceReason: sourcePolicy.reason,
          entityStatus: entityPolicy.status,
          entityReason: entityPolicy.reason,
        },
      };

      const entity = await this.prisma.discoveredEntity.upsert({
        where: { campaignId_dedupeKey: { campaignId: input.campaignId, dedupeKey } },
        update: {
          sourceRunId: matchingRun?.id ?? null,
          opportunityProfileId: input.opportunityProfileId,
          companyName: candidate.companyName,
          personName: candidate.personName ?? null,
          inferredRole: candidate.inferredRole ?? null,
          websiteUrl: candidate.websiteUrl ?? null,
          domain: candidate.domain ?? null,
          geography: candidate.geography ?? null,
          sourceEvidenceJson: toPrismaJson(evidence),
          entityConfidence: candidate.confidence,
          status: 'DISCOVERED',
        },
        create: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          campaignId: input.campaignId,
          sourceRunId: matchingRun?.id ?? null,
          opportunityProfileId: input.opportunityProfileId,
          companyName: candidate.companyName,
          personName: candidate.personName ?? null,
          inferredRole: candidate.inferredRole ?? null,
          websiteUrl: candidate.websiteUrl ?? null,
          domain: candidate.domain ?? null,
          geography: candidate.geography ?? null,
          sourceEvidenceJson: toPrismaJson(evidence),
          entityConfidence: candidate.confidence,
          dedupeKey,
          status: 'DISCOVERED',
        },
      });
      created.push(entity);
    }

    return { sourceRuns, entities: created };
  }

  private uniqueCandidates(items: DiscoveryCandidate[]) {
    const map = new Map<string, DiscoveryCandidate>();
    for (const item of items) {
      const key = `${item.companyName.toLowerCase()}|${(item.personName || '').toLowerCase()}|${(item.domain || '').toLowerCase()}`;
      if (!map.has(key) || (map.get(key)?.confidence ?? 0) < item.confidence) {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  }
}
