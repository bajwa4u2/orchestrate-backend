import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ScoringWorkerService {
  constructor(private readonly prisma: PrismaService) {}

  async scoreLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { contact: true, account: true },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    let score = 40;
    if (lead.contact?.email) score += 20;
    if (lead.contact?.title) score += 10;
    if (lead.account?.companyName) score += 10;
    if (lead.account?.domain) score += 10;
    if (lead.priority && lead.priority > 70) score += 10;

    score = Math.max(1, Math.min(100, score));

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        score: new Prisma.Decimal(score),
        priority: Math.max(lead.priority ?? 50, score),
      },
    });

    return { ok: true, worker: 'scoring', leadId, score };
  }
}
