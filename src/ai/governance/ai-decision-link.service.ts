import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { toPrismaJson } from '../../common/utils/prisma-json';
import { AiAuthorityEntityRef } from '../contracts/ai-authority.contract';
import { AiGovernanceEntityLinkInput } from './ai-governance.contract';

@Injectable()
export class AiDecisionLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async createLinks(input: {
    decisionId: string;
    organizationId: string;
    entity: AiAuthorityEntityRef;
    extraLinks?: AiGovernanceEntityLinkInput[];
  }) {
    const links = this.normalizeLinks(input.entity, input.extraLinks);
    if (!links.length) return [];

    const created: Awaited<ReturnType<typeof this.prisma.aiDecisionEntityLink.upsert>>[] = [];
    for (const link of links) {
      created.push(
        await this.prisma.aiDecisionEntityLink.upsert({
          where: {
            decisionId_entityType_entityId_role: {
              decisionId: input.decisionId,
              entityType: link.entityType,
              entityId: link.entityId,
              role: link.role ?? 'CONTEXT',
            },
          },
          update: {
            metadataJson: toPrismaJson(link.metadata ?? null),
          },
          create: {
            decisionId: input.decisionId,
            organizationId: input.organizationId,
            entityType: link.entityType,
            entityId: link.entityId,
            role: link.role ?? 'CONTEXT',
            metadataJson: toPrismaJson(link.metadata ?? null),
          },
        }),
      );
    }

    return created;
  }

  async ensureEntityMatch(input: {
    decisionId: string;
    entityType: string;
    entityId: string;
  }) {
    return this.prisma.aiDecisionEntityLink.findFirst({
      where: {
        decisionId: input.decisionId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  }

  private normalizeLinks(entity: AiAuthorityEntityRef, extraLinks: AiGovernanceEntityLinkInput[] = []) {
    const baseLinks: AiGovernanceEntityLinkInput[] = [];

    const add = (entityType: string, entityId?: string | null, role: AiGovernanceEntityLinkInput['role'] = 'CONTEXT') => {
      if (!entityId) return;
      baseLinks.push({ entityType, entityId, role });
    };

    add('organization', entity.organizationId, 'CONTEXT');
    add('client', entity.clientId, entity.clientId && !entity.campaignId && !entity.leadId ? 'PRIMARY_SUBJECT' : 'CONTEXT');
    add('campaign', entity.campaignId, entity.campaignId && !entity.leadId ? 'PRIMARY_SUBJECT' : 'CONTEXT');
    add('lead', entity.leadId, 'PRIMARY_SUBJECT');
    add('reply', entity.replyId, 'PRIMARY_SUBJECT');
    add('meeting', entity.meetingId, 'PRIMARY_SUBJECT');
    add('invoice', entity.invoiceId, 'PRIMARY_SUBJECT');
    add('agreement', entity.agreementId, 'PRIMARY_SUBJECT');
    add('job', entity.jobId, 'RELATED');
    add('workflow_run', entity.workflowRunId, 'RELATED');

    const deduped = new Map<string, AiGovernanceEntityLinkInput>();
    for (const link of [...baseLinks, ...extraLinks]) {
      if (!link.entityType || !link.entityId) continue;
      const normalized: AiGovernanceEntityLinkInput = {
        entityType: link.entityType,
        entityId: link.entityId,
        role: link.role ?? 'CONTEXT',
        metadata: link.metadata ?? {},
      };
      deduped.set(`${normalized.entityType}:${normalized.entityId}:${normalized.role}`, normalized);
    }

    return Array.from(deduped.values());
  }
}
