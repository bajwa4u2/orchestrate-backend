import { Injectable } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { CreateStatementDto } from './dto/create-statement.dto';

@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.statement.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, invoiceLinks: { include: { invoice: true } }, paymentLinks: { include: { payment: true } }, documentDispatches: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(organizationId: string, actorUserId: string | undefined, dto: CreateStatementDto) {
    const [openingInvoices, openingPayments, openingCredits, invoices, payments, credits, count] = await this.prisma.$transaction([
      this.prisma.invoice.aggregate({ where: { organizationId, clientId: dto.clientId, issuedAt: { lt: dto.periodStart } }, _sum: { totalCents: true } }),
      this.prisma.payment.aggregate({ where: { organizationId, clientId: dto.clientId, status: 'SUCCEEDED', receivedAt: { lt: dto.periodStart } }, _sum: { amountCents: true } }),
      this.prisma.creditNote.aggregate({ where: { organizationId, clientId: dto.clientId, issuedAt: { lt: dto.periodStart } }, _sum: { amountCents: true } }),
      this.prisma.invoice.findMany({
        where: { organizationId, clientId: dto.clientId, issuedAt: { gte: dto.periodStart, lte: dto.periodEnd } },
        select: { id: true, totalCents: true },
      }),
      this.prisma.payment.findMany({
        where: { organizationId, clientId: dto.clientId, status: 'SUCCEEDED', receivedAt: { gte: dto.periodStart, lte: dto.periodEnd } },
        select: { id: true, amountCents: true },
      }),
      this.prisma.creditNote.findMany({
        where: { organizationId, clientId: dto.clientId, issuedAt: { gte: dto.periodStart, lte: dto.periodEnd } },
        select: { id: true, amountCents: true },
      }),
      this.prisma.statement.count({ where: { organizationId } }),
    ]);

    const openingBalanceCents = (openingInvoices._sum.totalCents ?? 0) - (openingPayments._sum.amountCents ?? 0) - (openingCredits._sum.amountCents ?? 0);
    const totalInvoicedCents = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const totalPaidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const totalCreditedCents = credits.reduce((sum, credit) => sum + credit.amountCents, 0);
    const balanceCents = openingBalanceCents + totalInvoicedCents - totalPaidCents - totalCreditedCents;

    return this.prisma.statement.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        createdById: actorUserId,
        statementNumber: dto.statementNumber ?? `STM-${String(count + 1).padStart(5, '0')}`,
        label: dto.label,
        status: dto.status ?? StatementStatus.DRAFT,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        issuedAt: dto.issuedAt,
        totalInvoicedCents,
        totalPaidCents,
        balanceCents,
        metadataJson: toPrismaJson({ ...(dto.metadataJson ?? {}), openingBalanceCents, totalCreditedCents }),
        invoiceLinks: { create: invoices.map((invoice) => ({ invoiceId: invoice.id })) },
        paymentLinks: { create: payments.map((payment) => ({ paymentId: payment.id })) },
      },
      include: { invoiceLinks: true, paymentLinks: true },
    });
  }
}
