import { Injectable } from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.reminderArtifact.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, invoice: true, agreement: true },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  create(organizationId: string, createdById: string | undefined, dto: CreateReminderDto) {
    return this.prisma.reminderArtifact.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        createdById,
        kind: dto.kind,
        status: dto.status ?? 'PENDING',
        invoiceId: dto.invoiceId,
        agreementId: dto.agreementId,
        dueAt: dto.dueAt,
        scheduledAt: dto.scheduledAt,
        subjectLine: dto.subjectLine,
        bodyText: dto.bodyText,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
      include: { client: true, invoice: true, agreement: true },
    });
  }
}
