import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { getIssuerBlockLines, ORCHESTRATE_LEGAL_IDENTITY } from '../../financial-documents/legal-identity';

export type AgreementDocument = {
  id: string;
  organizationId: string;
  clientId: string;
  agreementNumber: string;
  title: string;
  status: string;
  effectiveStartAt: Date | null;
  effectiveEndAt: Date | null;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  acceptedByEmail: string | null;
  termsText: string;
  clientName: string;
  clientEmail: string | null;
  issuerLines: string[];
  relationshipStatement: string;
};

@Injectable()
export class AgreementDocumentBuilder {
  constructor(private readonly db: PrismaService) {}

  async buildByAgreementId(agreementId: string): Promise<AgreementDocument> {
    const agreement = await this.db.serviceAgreement.findUnique({
      where: { id: agreementId },
      include: {
        client: {
          select: {
            displayName: true,
            legalName: true,
            legalEmail: true,
            billingEmail: true,
            primaryEmail: true,
          },
        },
      },
    });

    if (!agreement) throw new NotFoundException('Agreement not found');

    return {
      id: agreement.id,
      organizationId: agreement.organizationId,
      clientId: agreement.clientId,
      agreementNumber: agreement.agreementNumber,
      title: agreement.title,
      status: agreement.status,
      effectiveStartAt: agreement.effectiveStartAt,
      effectiveEndAt: agreement.effectiveEndAt,
      acceptedAt: agreement.acceptedAt,
      acceptedByName: agreement.acceptedByName,
      acceptedByEmail: agreement.acceptedByEmail,
      termsText: agreement.termsText?.trim() || 'Service terms to be provided by Aura Platform LLC and accepted by the client before services begin.',
      clientName: agreement.client.displayName || agreement.client.legalName,
      clientEmail: agreement.client.legalEmail || agreement.client.billingEmail || agreement.client.primaryEmail,
      issuerLines: getIssuerBlockLines(),
      relationshipStatement: ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
    };
  }
}
