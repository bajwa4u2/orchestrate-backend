import { Injectable } from '@nestjs/common';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { CreateServiceAgreementDto } from './dto/create-service-agreement.dto';

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
  ) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.serviceAgreement.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, subscription: true },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async create(organizationId: string, createdById: string | undefined, dto: CreateServiceAgreementDto) {
    const count = await this.prisma.serviceAgreement.count({ where: { organizationId } });
    const agreement = await this.prisma.serviceAgreement.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        subscriptionId: dto.subscriptionId,
        createdById,
        agreementNumber: dto.agreementNumber ?? `AGR-${String(count + 1).padStart(5, '0')}`,
        title: dto.title,
        status: dto.status ?? 'DRAFT',
        effectiveStartAt: dto.effectiveStartAt,
        effectiveEndAt: dto.effectiveEndAt,
        termsText: dto.termsText,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
      include: { client: true, subscription: true },
    });

    if (agreement.status === 'ISSUED') {
      await this.sendAgreementIssuedEmail(organizationId, agreement);
    }

    return agreement;
  }

  private async sendAgreementIssuedEmail(
    organizationId: string,
    agreement: { clientId: string; agreementNumber: string; title: string; effectiveStartAt?: Date | null },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, agreement.clientId);
    if (!recipient?.email) return;

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent: 'agreement_sent',
        toEmail: recipient.email,
        toName: recipient.name,
        subject: `Service agreement ${agreement.agreementNumber}`,
        bodyText: [
          `Your Orchestrate service agreement is ready.`,
          `Agreement number: ${agreement.agreementNumber}.`,
          `Title: ${agreement.title}.`,
          agreement.effectiveStartAt ? `Effective start: ${agreement.effectiveStartAt.toISOString()}.` : null,
          `The contracting party is Aura Platform LLC.`,
        ].filter(Boolean).join('\n\n'),
      });
    } catch (error) {
      console.warn('[agreements] Failed to send agreement email', {
        organizationId,
        clientId: agreement.clientId,
        agreementNumber: agreement.agreementNumber,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
