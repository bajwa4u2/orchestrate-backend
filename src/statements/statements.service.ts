import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { CreateStatementDto } from './dto/create-statement.dto';

@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.statement.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, invoiceLinks: { include: { invoice: true } }, paymentLinks: { include: { payment: true } } },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(organizationId: string, actorUserId: string | undefined, dto: CreateStatementDto) {
    const [invoices, payments, count] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          clientId: dto.clientId,
          createdAt: { gte: dto.periodStart, lte: dto.periodEnd },
        },
        select: { id: true, totalCents: true, amountPaidCents: true },
      }),
      this.prisma.payment.findMany({
        where: {
          organizationId,
          clientId: dto.clientId,
          receivedAt: { gte: dto.periodStart, lte: dto.periodEnd },
        },
        select: { id: true, amountCents: true },
      }),
      this.prisma.statement.count({ where: { organizationId } }),
    ]);

    const totalInvoicedCents = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const totalPaidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const balanceCents = totalInvoicedCents - totalPaidCents;

    return this.prisma.statement.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        createdById: actorUserId,
        statementNumber: dto.statementNumber ?? `STM-${String(count + 1).padStart(5, '0')}`,
        label: dto.label,
        status: dto.status ?? 'DRAFT',
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        issuedAt: dto.issuedAt,
        totalInvoicedCents,
        totalPaidCents,
        balanceCents,
        metadataJson: toPrismaJson(dto.metadataJson),
        invoiceLinks: {
          create: invoices.map((invoice) => ({ invoiceId: invoice.id }))
        },
        paymentLinks: {
          create: payments.map((payment) => ({ paymentId: payment.id }))
        },
      },
      include: { invoiceLinks: true, paymentLinks: true },
    });
  }
}
