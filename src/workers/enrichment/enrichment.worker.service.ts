import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { toPrismaJson } from '../../common/utils/prisma-json';

@Injectable()
export class EnrichmentWorkerService {
  constructor(private readonly prisma: PrismaService) {}

  async enrichLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { contact: true, account: true },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const inferredDomain = lead.account?.domain ?? this.extractDomain(lead.contact?.email);
    const inferredCompany = lead.account?.companyName ?? inferredDomain?.replace(/^www\./, '').split('.')[0] ?? null;
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: lead.status === 'NEW' ? 'ENRICHED' : lead.status,
        metadataJson: toPrismaJson({
          ...(lead.metadataJson && typeof lead.metadataJson === 'object' && !Array.isArray(lead.metadataJson)
            ? (lead.metadataJson as Record<string, unknown>)
            : {}),
          enrichment: {
            inferredDomain,
            inferredCompany,
            enrichedAt: new Date().toISOString(),
          },
        }),
      },
    });

    return { ok: true, worker: 'enrichment', leadId, inferredDomain, inferredCompany };
  }

  private extractDomain(email?: string | null) {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[1].toLowerCase();
  }
}
