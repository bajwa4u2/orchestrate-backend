import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { QualificationService } from './qualification.service';

@Controller('qualification')
export class QualificationController {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly qualificationService: QualificationService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('entities/:entityId/evaluate')
  async evaluate(@Headers() headers: Record<string, unknown>, @Param('entityId') entityId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    return this.qualificationService.evaluateEntity({ entityId, organizationId: context.organizationId! });
  }

  @Get('campaigns/:campaignId')
  async list(@Headers() headers: Record<string, unknown>, @Param('campaignId') campaignId: string) {
    const context = await this.accessContextService.requireOperator(headers);
    const items = await this.prisma.qualificationDecision.findMany({
      where: { campaignId, organizationId: context.organizationId! },
      orderBy: { decidedAt: 'desc' },
    });
    return { items };
  }
}
