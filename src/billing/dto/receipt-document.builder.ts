import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { getIssuerBlockLines, ORCHESTRATE_LEGAL_IDENTITY } from '../../financial-documents/legal-identity';

export type ReceiptDocument = {
  id: string;
  organizationId: string;
  clientId: string;
  receiptNumber: string;
  currencyCode: string;
  amountCents: number;
  issuedAt: Date;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  paymentReceivedAt: Date | null;
  balanceAfterPaymentCents: number | null;
  clientName: string;
  clientEmail: string | null;
  issuerName: string;
  issuerLines: string[];
  headerTitle: string;
  relationshipStatement: string;
};

@Injectable()
export class ReceiptDocumentBuilder {
  constructor(private readonly db: PrismaService) {}

  async buildByReceiptId(receiptId: string): Promise<ReceiptDocument> {
    const receipt = await this.db.receipt.findUnique({
      where: { id: receiptId },
      include: {
        client: {
          select: {
            displayName: true,
            legalName: true,
            billingEmail: true,
            primaryEmail: true,
            legalEmail: true,
          },
        },
        invoice: { select: { invoiceNumber: true, balanceDueCents: true } },
        payment: { select: { method: true, externalRef: true, receivedAt: true } },
      },
    });

    if (!receipt) throw new NotFoundException('Receipt not found');

    return {
      id: receipt.id,
      organizationId: receipt.organizationId,
      clientId: receipt.clientId,
      receiptNumber: receipt.receiptNumber,
      currencyCode: receipt.currencyCode,
      amountCents: receipt.amountCents,
      issuedAt: receipt.issuedAt,
      invoiceNumber: receipt.invoice?.invoiceNumber ?? null,
      paymentMethod: receipt.payment?.method ?? null,
      paymentReference: receipt.payment?.externalRef ?? null,
      paymentReceivedAt: receipt.payment?.receivedAt ?? null,
      balanceAfterPaymentCents: receipt.invoice?.balanceDueCents ?? null,
      clientName: receipt.client.displayName || receipt.client.legalName,
      clientEmail: receipt.client.billingEmail || receipt.client.primaryEmail || receipt.client.legalEmail,
      issuerName: ORCHESTRATE_LEGAL_IDENTITY.legalEntityName,
      issuerLines: getIssuerBlockLines(),
      headerTitle: 'Payment Receipt',
      relationshipStatement: ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
    };
  }
}
