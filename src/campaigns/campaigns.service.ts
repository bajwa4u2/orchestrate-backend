import { Injectable } from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { buildPagination } from '../common/utils/pagination';
import { PrismaService } from '../database/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        organizationId: dto.organizationId,
        clientId: dto.clientId,
        icpId: dto.icpId,
        segmentId: dto.segmentId,
        createdById: dto.createdById,
        code: dto.code,
        name: dto.name,
        status: dto.status,
        channel: dto.channel,
        objective: dto.objective,
        offerSummary: dto.offerSummary,
        bookingUrlOverride: dto.bookingUrlOverride,
        dailySendCap: dto.dailySendCap,
        timezone: dto.timezone,
        startAt: dto.startAt,
        endAt: dto.endAt,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
    });
  }

  async list(query: ListCampaignsDto) {
    const { page, limit, skip, take } = buildPagination(query.page, query.limit);
    const where = {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { objective: { contains: query.search, mode: 'insensitive' as const } },
              { offerSummary: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { client: true },
        skip,
        take,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }
}
