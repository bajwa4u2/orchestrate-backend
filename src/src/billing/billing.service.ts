import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { formatMoney } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
  ) {}

  async overview(organizationId: string, clientId?: string) {
    const where = { organizationId, ...(clientId ? { clientId } : {}) };
    const now = new Date();

    const [
      invoicesIssued,
      overdueInvoices,
      openStatements,
      activeSubscriptions,
      paymentsSucceeded,
      totalInvoiced,
      totalCollected,
      receiptCount,
      creditTotal,
    ] = await Promise.all([
      this.prisma.invoice.count({ where: { ...where, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] } } }),
      this.prisma.invoice.count({ where: { ...where, dueAt: { lt: now }, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } } }),
      this.prisma.statement.count({ where: { ...where, status: { in: ['DRAFT', 'ISSUED'] } } }),
      this.prisma.subscription.count({ where: { ...where, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } } }),
      this.prisma.payment.count({ where: { ...where, status: PaymentStatus.SUCCEEDED } }),
      this.prisma.invoice.aggregate({ where, _sum: { totalCents: true, amountPaidCents: true, balanceDueCents: true } }),
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.SUCCEEDED }, _sum: { amountCents: true } }),
      this.prisma.receipt.count({ where }),
      this.prisma.creditNote.aggregate({ where, _sum: { amountCents: true } }),
    ]);

    return {
      scope: { organizationId, clientId: clientId ?? null },
      invoices: {
        open: invoicesIssued,
        overdue: overdueInvoices,
        totalInvoicedCents: totalInvoiced._sum.totalCents ?? 0,
        totalPaidAgainstInvoicesCents: totalInvoiced._sum.amountPaidCents ?? 0,
        totalBalanceDueCents: totalInvoiced._sum.balanceDueCents ?? 0,
      },
      collections: {
        succeededPayments: paymentsSucceeded,
        collectedCents: totalCollected._sum.amountCents ?? 0,
        receiptCount,
      },
      adjustments: {
        creditedCents: creditTotal._sum.amountCents ?? 0,
      },
      subscriptions: {
        active: activeSubscriptions,
      },
      statements: {
        open: openStatements,
      },
    };
  }

  async listInvoices(organizationId: string, clientId?: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: {
        client: true,
        subscription: true,
        lines: { orderBy: { sortOrder: 'asc' } },
        receipts: { orderBy: { issuedAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async listReceipts(organizationId: string, clientId?: string) {
    return this.prisma.receipt.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: {
        client: true,
        invoice: { select: { invoiceNumber: true, totalCents: true, amountPaidCents: true, balanceDueCents: true } },
        payment: { select: { method: true, externalRef: true, receivedAt: true, status: true } },
        documentDispatches: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createInvoice(organizationId: string, createdById: string | undefined, dto: CreateInvoiceDto) {
    const client = await this.prisma.client.findFirst({
      where: { id: dto.clientId, organizationId },
      select: { id: true, currencyCode: true, displayName: true },
    });
    if (!client) throw new NotFoundException('Client not found in active organization');

    const invoiceNumber = dto.invoiceNumber ?? (await this.generateInvoiceNumber(organizationId));
    const subtotalCents = dto.lines.reduce((sum, line) => sum + ((line.quantity ?? 1) * line.unitAmountCents), 0);
    const taxCents = dto.taxCents ?? 0;
    const totalCents = subtotalCents + taxCents;

    const invoice = await this.prisma.invoice.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        subscriptionId: dto.subscriptionId,
        billingProfileId: dto.billingProfileId,
        createdById,
        invoiceNumber,
        currencyCode: dto.currencyCode ?? client.currencyCode,
        status: dto.issuedAt ? InvoiceStatus.ISSUED : InvoiceStatus.DRAFT,
        subtotalCents,
        taxCents,
        totalCents,
        balanceDueCents: totalCents,
        issuedAt: dto.issuedAt,
        dueAt: dto.dueAt,
        notesText: dto.notesText,
        metadataJson: toPrismaJson(dto.metadataJson),
        lines: {
          create: dto.lines.map((line, index) => ({
            description: line.description,
            serviceCategory: line.serviceCategory,
            quantity: line.quantity ?? 1,
            unitAmountCents: line.unitAmountCents,
            subtotalCents: (line.quantity ?? 1) * line.unitAmountCents,
            totalAmountCents: (line.quantity ?? 1) * line.unitAmountCents,
            sortOrder: line.sortOrder ?? index,
            metadataJson: toPrismaJson(line.metadataJson),
          })),
        },
      },
      include: { lines: true, client: true },
    });

    if (invoice.status === InvoiceStatus.ISSUED) {
      await this.sendInvoiceIssuedEmail(organizationId, invoice);
    }

    return invoice;
  }

  async recordPayment(organizationId: string, actorUserId: string | undefined, dto: RecordPaymentDto) {
    const payment = await this.prisma.payment.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        invoiceId: dto.invoiceId,
        externalRef: dto.externalRef,
        method: dto.method,
        status: dto.status ?? PaymentStatus.SUCCEEDED,
        currencyCode: dto.currencyCode ?? 'USD',
        amountCents: dto.amountCents,
        receivedAt: dto.receivedAt ?? new Date(),
        metadataJson: toPrismaJson({ ...(dto.metadataJson ?? {}), actorUserId }),
      },
      include: { invoice: true, client: true },
    });

    if (dto.invoiceId && (dto.status ?? PaymentStatus.SUCCEEDED) === PaymentStatus.SUCCEEDED) {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: dto.invoiceId, organizationId },
        select: { id: true, totalCents: true, amountPaidCents: true, invoiceNumber: true },
      });

      if (invoice) {
        const amountPaidCents = invoice.amountPaidCents + dto.amountCents;
        const balanceDueCents = Math.max(invoice.totalCents - amountPaidCents, 0);
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaidCents,
            balanceDueCents,
            paidAt: amountPaidCents >= invoice.totalCents ? new Date() : undefined,
            status: amountPaidCents >= invoice.totalCents ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
          },
        });

        const receipt = await this.prisma.receipt.create({
          data: {
            organizationId,
            clientId: dto.clientId,
            invoiceId: dto.invoiceId,
            paymentId: payment.id,
            receiptNumber: await this.generateReceiptNumber(organizationId),
            currencyCode: payment.currencyCode,
            amountCents: payment.amountCents,
            issuedAt: payment.receivedAt ?? new Date(),
            metadataJson: { source: 'payment-recorded', actorUserId } as Prisma.InputJsonValue,
          },
        });

        await this.sendPaymentReceivedEmail(organizationId, {
          clientId: payment.clientId,
          invoiceNumber: invoice.invoiceNumber,
          receiptNumber: receipt.receiptNumber,
          amountCents: payment.amountCents,
          currencyCode: payment.currencyCode,
          receivedAt: payment.receivedAt ?? new Date(),
        });
      }
    }

    return payment;
  }

  private async sendInvoiceIssuedEmail(
    organizationId: string,
    invoice: { clientId: string; client?: { displayName?: string | null } | null; invoiceNumber: string; totalCents: number; currencyCode: string; dueAt?: Date | null },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, invoice.clientId);
    if (!recipient?.email) return;

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent: 'invoice_issued',
        toEmail: recipient.email,
        toName: recipient.name,
        subject: `Invoice ${invoice.invoiceNumber} from ${ORCHESTRATE_LEGAL_IDENTITY.brandName}`,
        bodyText: [
          `Your invoice ${invoice.invoiceNumber} is ready.`,
          `Amount: ${formatMoney(invoice.totalCents, invoice.currencyCode)}.`,
          invoice.dueAt ? `Due date: ${invoice.dueAt.toISOString()}.` : null,
          `Reply to this email if you need billing support.`,
          ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
        ].filter(Boolean).join('\n\n'),
      });
    } catch (error) {
      console.warn('[billing] Failed to send invoice email', {
        organizationId,
        clientId: invoice.clientId,
        invoiceNumber: invoice.invoiceNumber,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async sendPaymentReceivedEmail(
    organizationId: string,
    input: { clientId: string; invoiceNumber?: string | null; receiptNumber: string; amountCents: number; currencyCode: string; receivedAt: Date },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, input.clientId);
    if (!recipient?.email) return;

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent: 'payment_received',
        toEmail: recipient.email,
        toName: recipient.name,
        subject: `Payment received${input.invoiceNumber ? ` for ${input.invoiceNumber}` : ''}`,
        bodyText: [
          `Payment received. Thank you.`,
          `Receipt number: ${input.receiptNumber}.`,
          `Amount: ${formatMoney(input.amountCents, input.currencyCode)}.`,
          `Received: ${input.receivedAt.toISOString()}.`,
          ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
        ].join('\n\n'),
      });
    } catch (error) {
      console.warn('[billing] Failed to send payment receipt email', {
        organizationId,
        clientId: input.clientId,
        receiptNumber: input.receiptNumber,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async generateInvoiceNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.invoice.count({ where: { organizationId } });
    return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private async generateReceiptNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.receipt.count({ where: { organizationId } });
    return `RCT-${year}-${String(count + 1).padStart(4, '0')}`;
  }
}
