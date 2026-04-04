import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { EmailsService } from '../emails/emails.service';
import { CreateStatementDto } from './dto/create-statement.dto';

@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
  ) {}

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

    const statement = await this.prisma.statement.create({
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

    if (statement.status === 'ISSUED' || statement.issuedAt) {
      await this.sendStatementIssuedEmail(organizationId, {
        clientId: statement.clientId,
        statementNumber: statement.statementNumber,
        label: statement.label,
        totalInvoicedCents: statement.totalInvoicedCents,
        totalPaidCents: statement.totalPaidCents,
        balanceCents: statement.balanceCents,
      });
    }

    return statement;
  }

  private async sendStatementIssuedEmail(
    organizationId: string,
    statement: { clientId: string; statementNumber: string; label?: string | null; totalInvoicedCents: number; totalPaidCents: number; balanceCents: number },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, statement.clientId);
    if (!recipient?.email) return;

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent: 'statement_issued',
        toEmail: recipient.email,
        toName: recipient.name,
        subject: `Statement ${statement.statementNumber} is ready`,
        bodyText: [
          `Your statement ${statement.statementNumber} is ready.`,
          statement.label ? `Label: ${statement.label}.` : null,
          `Total invoiced: ${this.formatMoney(statement.totalInvoicedCents)}.`,
          `Total paid: ${this.formatMoney(statement.totalPaidCents)}.`,
          `Balance: ${this.formatMoney(statement.balanceCents)}.`,
          `Orchestrate is a product of Aura Platform LLC.`,
        ].filter(Boolean).join('\n\n'),
      });
    } catch (error) {
      console.warn('[statements] Failed to send statement email', {
        organizationId,
        clientId: statement.clientId,
        statementNumber: statement.statementNumber,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private formatMoney(amountCents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format((amountCents || 0) / 100);
  }
}
