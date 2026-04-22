import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { ReachabilityBuilderService } from './reachability-builder.service';

@Controller('reachability')
export class ReachabilityController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly reachabilityBuilderService: ReachabilityBuilderService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('entities/:entityId/build')
  async build(@Headers() headers: Record<string, unknown>, @Param('entityId') entityId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.reachabilityBuilderService.buildForEntity({ entityId, organizationId: context.organizationId! });
  }

  @Get('entities/:entityId')
  async list(@Headers() headers: Record<string, unknown>, @Param('entityId') entityId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    const items = await this.prisma.reachabilityRecord.findMany({
      where: {
        discoveredEntityId: entityId,
        organizationId: context.organizationId!,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }
}
