import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class InboxSyncWorkerService {
  constructor(private readonly prisma: PrismaService) {}

  async runMailboxSync(input: { clientId?: string; organizationId?: string; campaignId?: string } = {}) {
    const unmatchedReplies = await this.prisma.reply.findMany({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.campaignId ? { campaignId: input.campaignId } : {}),
        handledAt: null,
      },
      select: { id: true, messageId: true, fromEmail: true, receivedAt: true },
      orderBy: [{ receivedAt: 'desc' }],
      take: 50,
    });

    return {
      ok: true,
      worker: 'inbox_sync',
      unmatchedReplyCount: unmatchedReplies.length,
      unmatchedReplies,
    };
  }
}
