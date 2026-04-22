import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';

@Injectable()
export class ReachabilityBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async buildForEntity(input: { entityId: string; organizationId?: string }) {
    const entity = await this.prisma.discoveredEntity.findFirst({
      where: { id: input.entityId, ...(input.organizationId ? { organizationId: input.organizationId } : {}) },
    });
    if (!entity) throw new NotFoundException('Discovered entity not found');

    const domain = entity.domain || this.deriveDomain(entity.websiteUrl, entity.companyName);
    const personName = entity.personName?.trim() || '';
    const parts = personName.split(/\s+/).filter(Boolean);
    const firstName = parts[0]?.toLowerCase() || 'hello';
    const lastName = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'team';
    const roleLocalPart = this.roleLocalPart(entity.inferredRole);
    const pattern = personName ? 'first.last' : roleLocalPart;
    const emailCandidate = domain ? (personName ? `${firstName}.${lastName}@${domain}` : `${roleLocalPart}@${domain}`) : null;
    const score = emailCandidate ? (personName ? 82 : 68) : 30;

    const record = await this.prisma.reachabilityRecord.create({
      data: {
        organizationId: entity.organizationId,
        clientId: entity.clientId,
        campaignId: entity.campaignId,
        discoveredEntityId: entity.id,
        domain: domain ?? null,
        contactPageUrl: entity.websiteUrl ? `${entity.websiteUrl.replace(/\/$/, '')}/contact` : null,
        emailCandidate,
        emailPattern: pattern,
        verificationStatus: emailCandidate ? 'PATTERN_CONSTRUCTED' : 'UNVERIFIED',
        reachabilityScore: score,
        suppressionStatus: null,
        notesJson: toPrismaJson({
          derivedFrom: 'internal_reachability_builder',
          inferredRole: entity.inferredRole,
        }),
      },
    });

    return { entity, record };
  }

  private deriveDomain(websiteUrl: string | null | undefined, companyName: string) {
    const site = typeof websiteUrl === 'string' ? websiteUrl.trim() : '';
    if (site) {
      return site.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
    }

    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
    return slug ? `${slug}.com` : null;
  }

  private roleLocalPart(role?: string | null) {
    const text = (role || '').toLowerCase();
    if (text.includes('owner')) return 'owner';
    if (text.includes('founder')) return 'founder';
    if (text.includes('director')) return 'director';
    if (text.includes('manager')) return 'manager';
    return 'hello';
  }
}
