import { Injectable } from '@nestjs/common';
import { buildPagination } from '../common/utils/pagination';
import { PrismaService } from '../database/prisma.service';
import { ListMeetingsDto } from './dto/list-meetings.dto';

@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMeetingsDto) {
    const { page, limit, skip, take } = buildPagination(query.page, query.limit);
    const where = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where,
        include: { lead: true, client: true, campaign: true, reply: true },
        orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }
}
