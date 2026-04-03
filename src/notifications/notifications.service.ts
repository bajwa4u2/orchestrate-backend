import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertSeverity, AlertStatus, Prisma } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { ListAlertsDto } from './dto/list-alerts.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  listAlerts(organizationId: string, query: ListAlertsDto = {}) {
    return this.prisma.alert.findMany({
      where: {
        organizationId,
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.campaignId ? { campaignId: query.campaignId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  listClientAlerts(organizationId: string, clientId: string) {
    return this.prisma.alert.findMany({
      where: { organizationId, clientId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  createAlert(organizationId: string, actorUserId: string | undefined, dto: CreateAlertDto) {
    return this.prisma.alert.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        campaignId: dto.campaignId,
        severity: dto.severity,
        category: dto.category,
        title: dto.title,
        bodyText: dto.bodyText,
        metadataJson: toPrismaJson({ ...(dto.metadataJson ?? {}), actorUserId }),
      },
    });
  }

  async resolveAlert(organizationId: string, alertId: string, userId: string | undefined) {
    const alert = await this.prisma.alert.findFirst({ where: { id: alertId, organizationId } });
    if (!alert) throw new NotFoundException('Alert not found in active organization');

    return this.prisma.alert.update({
      where: { id: alert.id },
      data: {
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedById: userId,
      },
    });
  }

  async recordDocumentNotification(params: {
    organizationId: string;
    clientId?: string | null;
    actorUserId?: string;
    title: string;
    bodyText?: string | null;
    category: string;
    severity?: AlertSeverity;
    metadataJson?: Prisma.InputJsonValue;
  }) {
    const alert = await this.prisma.alert.create({
      data: {
        organizationId: params.organizationId,
        clientId: params.clientId ?? undefined,
        severity: params.severity ?? AlertSeverity.INFO,
        category: params.category,
        title: params.title,
        bodyText: params.bodyText ?? undefined,
        metadataJson: params.metadataJson,
      },
    });

    await this.prisma.activityEvent.create({
      data: {
        organizationId: params.organizationId,
        clientId: params.clientId ?? undefined,
        actorUserId: params.actorUserId,
        kind: 'NOTE_ADDED',
        subjectType: 'alert',
        subjectId: alert.id,
        summary: params.title,
        metadataJson: params.metadataJson,
      },
    });

    return alert;
  }
}
