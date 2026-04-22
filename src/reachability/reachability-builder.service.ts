import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { policyService } from '../common/policy/data-policy';

@Injectable()
export class ReachabilityBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async buildForEntity(input: { entityId: string; organizationId?: string }) {
    const entity = await this.prisma.discoveredEntity.findFirst({
      where: { id: input.entityId, ...(input.organizationId ? { organizationId: input.organizationId } : {}) },
    });
    if (!entity) throw new NotFoundException('Discovered entity not found');

    const entityPolicy = policyService.evaluateEntity({
      companyName: entity.companyName,
      personName: entity.personName,
      domain: entity.domain,
      websiteUrl: entity.websiteUrl,
    });

    const domain = entityPolicy.status === 'BLOCKED'
      ? null
      : entity.domain || this.deriveDomain(entity.websiteUrl, entity.companyName);

    const roleLocalPart = this.roleLocalPart(entity.inferredRole);
    const publicLocalPart = this.publicLocalPart(entity.inferredRole);
    const emailCandidate = domain ? `${publicLocalPart}@${domain}` : null;

    const contactPolicy = policyService.evaluateContact({
      email: emailCandidate,
      sourceType: this.readSourceType(entity.sourceEvidenceJson),
      domain,
      inferredRole: entity.inferredRole,
    });

    const record = await this.prisma.reachabilityRecord.create({
      data: {
        organizationId: entity.organizationId,
        clientId: entity.clientId,
        campaignId: entity.campaignId,
        discoveredEntityId: entity.id,
        domain: domain ?? null,
        contactPageUrl: entity.websiteUrl ? `${entity.websiteUrl.replace(/\/$/, '')}/contact` : null,
        emailCandidate: contactPolicy.status === 'BLOCKED' ? null : contactPolicy.normalizedEmail,
        emailPattern: domain ? (contactPolicy.status === 'JUSTIFIED' ? publicLocalPart : roleLocalPart) : null,
        verificationStatus: contactPolicy.status === 'BLOCKED' ? 'POLICY_BLOCKED' : 'PATTERN_CONSTRUCTED',
        reachabilityScore: this.reachabilityScore(contactPolicy.status),
        suppressionStatus: contactPolicy.status === 'BLOCKED' ? 'BLOCKED' : null,
        notesJson: toPrismaJson({
          derivedFrom: 'central_policy_reachability_builder',
          inferredRole: entity.inferredRole,
          policy: {
            entityStatus: entityPolicy.status,
            entityReason: entityPolicy.reason,
            contactStatus: contactPolicy.status,
            contactReason: contactPolicy.reason,
          },
        }),
      },
    });

    return { entity, record, policy: contactPolicy };
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

  private publicLocalPart(role?: string | null) {
    const text = (role || '').toLowerCase();
    if (text.includes('sales')) return 'sales';
    if (text.includes('support')) return 'support';
    return 'hello';
  }

  private reachabilityScore(status: 'JUSTIFIED' | 'REVIEW_REQUIRED' | 'BLOCKED') {
    if (status === 'JUSTIFIED') return 82;
    if (status === 'REVIEW_REQUIRED') return 58;
    return 18;
  }

  private readSourceType(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return typeof record.sourceType === 'string' ? record.sourceType : null;
  }
}
