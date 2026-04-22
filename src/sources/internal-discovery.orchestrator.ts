import { Injectable } from '@nestjs/common';
import { DiscoveredEntity } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { evaluateSourcePolicy } from '../common/policy/data-policy';
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
    allowedSourceTypes?: string[];
    sourcePolicies?: Array<Record<string, unknown>>;
  }) {
    const sourceRuns: Array<{ id: string; sourceType: string }> = [];
    const allowedSourceTypes = new Set((input.allowedSourceTypes ?? ['SEARCH', 'DIRECTORY', 'WEBSITE']).map((v) => v.toUpperCase()));

    const searchCandidates =
      allowedSourceTypes.has('SEARCH')
        ? await this.runSource({
            sourceType: 'SEARCH',
            input,
            sourceRuns,
            discover: () =>
              this.searchProvider.discover({
                campaignName: input.campaignName,
                objective: input.objective,
                offerSummary: input.offerSummary,
                seedProspects: input.seedProspects,
                geography: input.geography,
                limit: input.limit,
              }),
          })
        : [];

    const directoryCandidates =
      allowedSourceTypes.has('DIRECTORY')
        ? await this.runSource({
            sourceType: 'DIRECTORY',
            input,
            sourceRuns,
            discover: () =>
              this.directoryProvider.discover({
                clientName: input.clientName,
                industry: input.industry,
                geography: input.geography,
                limit: Math.min(input.limit, 10),
              }),
          })
        : [];

    const websiteCandidates =
      allowedSourceTypes.has('WEBSITE')
        ? await this.websiteProvider.discover({
            clientWebsiteUrl: input.clientWebsiteUrl,
            existingCandidates: [...searchCandidates, ...directoryCandidates],
          })
        : [];

    const allCandidates = this.uniqueCandidates([
      ...searchCandidates,
      ...directoryCandidates,
      ...websiteCandidates,
    ]).slice(0, input.limit);

    const created: DiscoveredEntity[] = [];

    for (const candidate of allCandidates) {
      const policy = evaluateSourcePolicy({
        sourceType: candidate.sourceType,
        websiteUrl: candidate.websiteUrl ?? null,
        domain: candidate.domain ?? null,
        evidence: candidate.evidence,
      });

      if (policy.status === 'BLOCKED') {
        continue;
      }

      const matchingRun =
        sourceRuns.find((item) => item.sourceType === candidate.sourceType) ?? sourceRuns[0];
      const dedupeKey = `${candidate.companyName.toLowerCase()}|${(
        candidate.personName || ''
      ).toLowerCase()}|${(candidate.domain || '').toLowerCase()}`;

      const sourceEvidence = {
        ...(this.asObject(candidate.evidence)),
        sourceType: candidate.sourceType,
        sourcePolicyStatus: policy.status,
        collectionMethod: policy.collectionMethod,
        policyReason: policy.reason,
      };

      const entity = await this.prisma.discoveredEntity.upsert({
        where: {
          campaignId_dedupeKey: {
            campaignId: input.campaignId,
            dedupeKey,
          },
        },
        update: {
          sourceRunId: matchingRun?.id ?? null,
          opportunityProfileId: input.opportunityProfileId,
          companyName: candidate.companyName,
          personName: candidate.personName ?? null,
          inferredRole: candidate.inferredRole ?? null,
          websiteUrl: candidate.websiteUrl ?? null,
          domain: candidate.domain ?? null,
          geography: candidate.geography ?? null,
          sourceEvidenceJson: toPrismaJson(sourceEvidence),
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
          sourceEvidenceJson: toPrismaJson(sourceEvidence),
          entityConfidence: candidate.confidence,
          dedupeKey,
          status: 'DISCOVERED',
        },
      });

      created.push(entity);
    }

    return { sourceRuns, entities: created };
  }

  private async runSource(args: {
    sourceType: string;
    input: {
      organizationId: string;
      clientId: string;
      campaignId: string;
      sourcePlanId: string;
      opportunityProfileId: string;
    };
    sourceRuns: Array<{ id: string; sourceType: string }>;
    discover: () => Promise<DiscoveryCandidate[]>;
  }) {
    const sourceRun = await this.prisma.sourceRun.create({
      data: {
        organizationId: args.input.organizationId,
        clientId: args.input.clientId,
        campaignId: args.input.campaignId,
        sourcePlanId: args.input.sourcePlanId,
        opportunityProfileId: args.input.opportunityProfileId,
        sourceType: args.sourceType,
        status: 'RUNNING',
      },
    });
    args.sourceRuns.push({ id: sourceRun.id, sourceType: args.sourceType });

    const candidates = await args.discover();

    await this.prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        resultCount: candidates.length,
      },
    });

    return candidates;
  }

  private uniqueCandidates(items: DiscoveryCandidate[]) {
    const map = new Map<string, DiscoveryCandidate>();

    for (const item of items) {
      const key = `${item.companyName.toLowerCase()}|${(item.personName || '').toLowerCase()}|${(
        item.domain || ''
      ).toLowerCase()}`;

      if (!map.has(key) || (map.get(key)?.confidence ?? 0) < item.confidence) {
        map.set(key, item);
      }
    }

    return Array.from(map.values());
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }
}
