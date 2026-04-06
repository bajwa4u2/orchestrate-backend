import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { getIssuerBlockLines, ORCHESTRATE_LEGAL_IDENTITY } from '../../financial-documents/legal-identity';

export type StatementDocument = {
  id: string;
  organizationId: string;
  clientId: string;
  statementNumber: string;
  label: string | null;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date | null;
  openingBalanceCents: number;
  invoicedDuringPeriodCents: number;
  paidDuringPeriodCents: number;
  creditedDuringPeriodCents: number;
  closingBalanceCents: number;
  currencyCode: string;
  clientName: string;
  clientEmail: string | null;
  invoiceCount: number;
  paymentCount: number;
  creditCount: number;
  issuerLines: string[];
  relationshipStatement: string;
};

@Injectable()
export class StatementDocumentBuilder {
  constructor(private readonly db: PrismaService) {}

  async buildByStatementId(statementId: string): Promise<StatementDocument> {
    const statement = await this.db.statement.findUnique({
      where: { id: statementId },
      include: {
        client: {
          select: {
            displayName: true,
            legalName: true,
            billingEmail: true,
            primaryEmail: true,
            legalEmail: true,
            currencyCode: true,
          },
        },
      },
    });

    if (!statement) throw new NotFoundException('Statement not found');

    const [openingInvoices, openingPayments, openingCredits, invoicesInPeriod, paymentsInPeriod, creditsInPeriod] = await this.db.$transaction([
      this.db.invoice.aggregate({
        where: { organizationId: statement.organizationId, clientId: statement.clientId, issuedAt: { lt: statement.periodStart } },
        _sum: { totalCents: true },
      }),
      this.db.payment.aggregate({
        where: { organizationId: statement.organizationId, clientId: statement.clientId, status: 'SUCCEEDED', receivedAt: { lt: statement.periodStart } },
        _sum: { amountCents: true },
      }),
      this.db.creditNote.aggregate({
        where: { organizationId: statement.organizationId, clientId: statement.clientId, issuedAt: { lt: statement.periodStart } },
        _sum: { amountCents: true },
      }),
      this.db.invoice.findMany({
        where: { organizationId: statement.organizationId, clientId: statement.clientId, issuedAt: { gte: statement.periodStart, lte: statement.periodEnd } },
        select: { id: true, totalCents: true },
      }),
      this.db.payment.findMany({
        where: { organizationId: statement.organizationId, clientId: statement.clientId, status: 'SUCCEEDED', receivedAt: { gte: statement.periodStart, lte: statement.periodEnd } },
        select: { id: true, amountCents: true },
      }),
      this.db.creditNote.findMany({
        where: { organizationId: statement.organizationId, clientId: statement.clientId, issuedAt: { gte: statement.periodStart, lte: statement.periodEnd } },
        select: { id: true, amountCents: true },
      }),
    ]);

    const openingBalanceCents = (openingInvoices._sum.totalCents ?? 0) - (openingPayments._sum.amountCents ?? 0) - (openingCredits._sum.amountCents ?? 0);
    const invoicedDuringPeriodCents = invoicesInPeriod.reduce((sum, item) => sum + item.totalCents, 0);
    const paidDuringPeriodCents = paymentsInPeriod.reduce((sum, item) => sum + item.amountCents, 0);
    const creditedDuringPeriodCents = creditsInPeriod.reduce((sum, item) => sum + item.amountCents, 0);
    const closingBalanceCents = openingBalanceCents + invoicedDuringPeriodCents - paidDuringPeriodCents - creditedDuringPeriodCents;

    return {
      id: statement.id,
      organizationId: statement.organizationId,
      clientId: statement.clientId,
      statementNumber: statement.statementNumber,
      label: statement.label,
      status: statement.status,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      issuedAt: statement.issuedAt,
      openingBalanceCents,
      invoicedDuringPeriodCents,
      paidDuringPeriodCents,
      creditedDuringPeriodCents,
      closingBalanceCents,
      currencyCode: statement.client.currencyCode || 'USD',
      clientName: statement.client.displayName || statement.client.legalName,
      clientEmail: statement.client.billingEmail || statement.client.primaryEmail || statement.client.legalEmail,
      invoiceCount: invoicesInPeriod.length,
      paymentCount: paymentsInPeriod.length,
      creditCount: creditsInPeriod.length,
      issuerLines: getIssuerBlockLines(),
      relationshipStatement: ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
    };
  }
}
