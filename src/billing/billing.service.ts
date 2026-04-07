import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentMethodType, PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { formatMoney } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { StripeService } from './stripe/stripe.service';

type CreateSubscriptionIntentInput = {
  organizationId: string;
  clientId: string;
  userId: string;
  email?: string;
  plan: 'OPPORTUNITY' | 'REVENUE';
};

type PortalSessionInput = {
  organizationId: string;
  clientId: string;
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailsService: EmailsService,
    private readonly stripeService: StripeService,
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
      this.prisma.invoice.count({
        where: { ...where, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] } },
      }),
      this.prisma.invoice.count({
        where: { ...where, dueAt: { lt: now }, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } },
      }),
      this.prisma.statement.count({ where: { ...where, status: { in: ['DRAFT', 'ISSUED'] } } }),
      this.prisma.subscription.count({
        where: { ...where, status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      }),
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
        invoice: {
          select: {
            invoiceNumber: true,
            totalCents: true,
            amountPaidCents: true,
            balanceDueCents: true,
          },
        },
        payment: {
          select: {
            method: true,
            externalRef: true,
            receivedAt: true,
            status: true,
          },
        },
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

  async createSubscriptionIntent(input: CreateSubscriptionIntentInput) {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, organizationId: input.organizationId },
      select: {
        id: true,
        displayName: true,
        legalName: true,
        currencyCode: true,
        primaryEmail: true,
        billingEmail: true,
        metadataJson: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found in active organization');
    }

    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        status: {
          in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
      },
      include: {
        plan: true,
        client: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    if (existingSubscription) {
      return {
        subscriptionId: existingSubscription.id,
        stripeSubscriptionId: existingSubscription.externalRef,
        clientSecret: null,
        customerId: this.readString(this.asObject(existingSubscription.metadataJson).stripeCustomerId) ?? null,
        plan: existingSubscription.plan
          ? {
              code: existingSubscription.plan.code,
              name: existingSubscription.plan.name,
              amountCents: existingSubscription.plan.amountCents,
              currencyCode: existingSubscription.plan.currencyCode,
              interval: existingSubscription.plan.interval,
            }
          : null,
        status: existingSubscription.status,
        alreadyExists: true,
      };
    }

    const plan = await this.resolvePlan(input.organizationId, input.plan);
    const clientMetadata = this.asObject(client.metadataJson);
    const billingMetadata = this.asObject((clientMetadata as Record<string, unknown>).billing as Prisma.JsonValue);

    let stripeCustomerId = this.readString(billingMetadata.stripeCustomerId);

    if (!stripeCustomerId) {
      const customer = await this.stripeService.createCustomer({
        email: client.billingEmail ?? client.primaryEmail ?? input.email,
        name: client.displayName ?? client.legalName ?? 'Client',
        metadata: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          planCode: plan.code,
        },
      });

      stripeCustomerId = customer.id;

      await this.prisma.client.update({
        where: { id: client.id },
        data: {
          metadataJson: toPrismaJson({
            ...clientMetadata,
            billing: {
              ...billingMetadata,
              stripeCustomerId,
              stripeCustomerCreatedAt: new Date().toISOString(),
            },
          }),
        },
      });
    }

    const stripeSubscription = await this.stripeService.createSubscription({
      customerId: stripeCustomerId!,
      priceId: this.resolveStripePriceId(input.plan),
      metadata: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        planCode: plan.code,
      },
    });

    const paymentIntent = this.extractPaymentIntent(stripeSubscription);
    if (!paymentIntent?.client_secret) {
      throw new BadRequestException('Stripe did not return a payment intent client secret');
    }

    const currentPeriodStart = this.readUnixTimestamp((stripeSubscription as any).current_period_start);
    const currentPeriodEnd = this.readUnixTimestamp((stripeSubscription as any).current_period_end);

    const localSubscription = await this.prisma.subscription.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        planId: plan.id,
        externalRef: stripeSubscription.id,
        status: SubscriptionStatus.TRIALING,
        amountCents: plan.amountCents,
        currencyCode: plan.currencyCode ?? client.currencyCode ?? 'USD',
        billingAnchorAt: currentPeriodStart ?? new Date(),
        currentPeriodStart,
        currentPeriodEnd,
        metadataJson: toPrismaJson({
          source: 'stripe',
          planCode: plan.code,
          stripeCustomerId,
          stripeSubscriptionId: stripeSubscription.id,
          stripePriceId: this.resolveStripePriceId(input.plan),
          createdByUserId: input.userId,
        }),
      },
      include: {
        plan: true,
        client: true,
      },
    });

    await this.sendSubscriptionCreatedEmail(input.organizationId, {
      clientId: input.clientId,
      planName: plan.name,
      amountCents: plan.amountCents,
      currencyCode: plan.currencyCode ?? 'USD',
    });

    return {
      subscriptionId: localSubscription.id,
      stripeSubscriptionId: stripeSubscription.id,
      clientSecret: paymentIntent.client_secret,
      customerId: stripeCustomerId,
      plan: {
        code: plan.code,
        name: plan.name,
        amountCents: plan.amountCents,
        currencyCode: plan.currencyCode,
        interval: plan.interval,
      },
      status: localSubscription.status,
      alreadyExists: false,
    };
  }

  async createPortalSession(input: PortalSessionInput) {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, organizationId: input.organizationId },
      select: { id: true, metadataJson: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found in active organization');
    }

    const clientMetadata = this.asObject(client.metadataJson);
    const billingMetadata = this.asObject((clientMetadata as Record<string, unknown>).billing as Prisma.JsonValue);
    const stripeCustomerId = this.readString(billingMetadata.stripeCustomerId);

    if (!stripeCustomerId) {
      throw new BadRequestException('No Stripe billing profile is linked to this client yet');
    }

    const session = await this.stripeService.createPortalSession({
      customerId: stripeCustomerId,
      returnUrl: process.env.CLIENT_PORTAL_BASE_URL?.trim() || 'https://orchestrateops.com/client',
    });

    return { url: session.url };
  }

  async getClientSubscription(organizationId: string, clientId: string) {
  const subscription = await this.prisma.subscription.findFirst({
    where: {
      organizationId,
      clientId,
      status: {
        in: [
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.PAST_DUE,
        ],
      },
    },
    include: {
      plan: true,
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  if (!subscription) {
    return null;
  }

  return {
    plan: subscription.plan?.name ?? null,
    status: subscription.status,
    amount: subscription.amountCents / 100,
    currency: subscription.currencyCode,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
}

  async handleInvoicePaid(invoice: any) {
    const stripeSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (!stripeSubscriptionId) return { ok: true };

    const subscription = await this.prisma.subscription.findFirst({
      where: { externalRef: stripeSubscriptionId },
      include: { plan: true, client: true },
    });

    if (!subscription) return { ok: true };

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: this.readUnixTimestamp(invoice.period_start) ?? subscription.currentPeriodStart,
        currentPeriodEnd: this.readUnixTimestamp(invoice.period_end) ?? subscription.currentPeriodEnd,
        metadataJson: toPrismaJson({
          ...this.asObject(subscription.metadataJson),
          latestStripeInvoiceId: invoice.id,
          latestInvoicePaidAt: new Date().toISOString(),
        }),
      },
    });

    const invoiceAmountCents = invoice.amount_paid ?? 0;
    if (invoiceAmountCents > 0) {
      await this.prisma.payment.create({
        data: {
          organizationId: subscription.organizationId,
          clientId: subscription.clientId,
          externalRef: invoice.payment_intent ? String(invoice.payment_intent) : invoice.id,
          method: PaymentMethodType.STRIPE,
          status: PaymentStatus.SUCCEEDED,
          currencyCode: (invoice.currency ?? subscription.currencyCode ?? 'usd').toUpperCase(),
          amountCents: invoiceAmountCents,
          receivedAt: new Date(),
          metadataJson: toPrismaJson({
            source: 'stripe-webhook',
            stripeInvoiceId: invoice.id,
            stripeSubscriptionId,
          }),
        },
      });
    }

    await this.sendSubscriptionRenewedEmail(subscription.organizationId, {
      clientId: subscription.clientId,
      planName: subscription.plan?.name ?? 'Subscription',
      amountCents: subscription.amountCents,
      currencyCode: subscription.currencyCode,
      currentPeriodEnd: subscription.currentPeriodEnd ?? undefined,
    });

    return { ok: true };
  }

  async handlePaymentFailed(invoice: any) {
    const stripeSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (!stripeSubscriptionId) return { ok: true };

    const subscription = await this.prisma.subscription.findFirst({
      where: { externalRef: stripeSubscriptionId },
      include: { plan: true },
    });

    if (!subscription) return { ok: true };

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        metadataJson: toPrismaJson({
          ...this.asObject(subscription.metadataJson),
          latestFailedStripeInvoiceId: invoice.id,
          latestPaymentFailureAt: new Date().toISOString(),
        }),
      },
    });

    await this.sendPaymentFailedNotice(subscription.organizationId, {
      clientId: subscription.clientId,
      planName: subscription.plan?.name ?? 'Subscription',
      amountCents: subscription.amountCents,
      currencyCode: subscription.currencyCode,
    });

    return { ok: true };
  }

  async handleSubscriptionUpdated(stripeSubscription: any) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { externalRef: stripeSubscription.id },
    });

    if (!subscription) return { ok: true };

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: this.mapStripeSubscriptionStatus(stripeSubscription.status),
        currentPeriodStart: this.readUnixTimestamp(stripeSubscription.current_period_start) ?? subscription.currentPeriodStart,
        currentPeriodEnd: this.readUnixTimestamp(stripeSubscription.current_period_end) ?? subscription.currentPeriodEnd,
        canceledAt: stripeSubscription.canceled_at
          ? this.readUnixTimestamp(stripeSubscription.canceled_at) ?? new Date()
          : null,
        metadataJson: toPrismaJson({
          ...this.asObject(subscription.metadataJson),
          stripeSubscriptionStatus: stripeSubscription.status,
          cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
          latestStripeCustomerId:
            typeof stripeSubscription.customer === 'string'
              ? stripeSubscription.customer
              : stripeSubscription.customer?.id,
        }),
      },
    });

    return { ok: true };
  }

  private async resolvePlan(organizationId: string, plan: 'OPPORTUNITY' | 'REVENUE') {
    const desiredCode = plan === 'OPPORTUNITY' ? 'OPPORTUNITY_MONTHLY' : 'REVENUE_MONTHLY';

    const existing = await this.prisma.plan.findFirst({
      where: { organizationId, code: desiredCode, isActive: true },
    });

    if (existing) return existing;

    const seed = {
      code: desiredCode,
      name: plan === 'OPPORTUNITY' ? 'Opportunity' : 'Revenue',
      description:
        plan === 'OPPORTUNITY'
          ? 'Generate meetings for your business.'
          : 'Generate meetings and manage the billing that follows.',
      amountCents: plan === 'OPPORTUNITY' ? 43500 : 87000,
      currencyCode: 'USD',
      interval: 'MONTHLY' as const,
      featuresJson:
        plan === 'OPPORTUNITY'
          ? {
              positioning: 'From first contact to scheduled meetings.',
              scope: ['lead sourcing', 'outreach execution', 'follow-ups', 'meeting booking'],
            }
          : {
              positioning: 'From meeting to invoice, payment, and record.',
              scope: ['lead sourcing', 'outreach execution', 'follow-ups', 'meeting booking', 'invoices', 'payment tracking', 'agreements', 'statements'],
            },
    };

    return this.prisma.plan.create({
      data: {
        organizationId,
        ...seed,
      },
    });
  }

  private resolveStripePriceId(plan: 'OPPORTUNITY' | 'REVENUE') {
    const priceId =
      plan === 'OPPORTUNITY'
        ? process.env.STRIPE_PRICE_OPPORTUNITY?.trim()
        : process.env.STRIPE_PRICE_REVENUE?.trim();

    if (!priceId) {
      throw new BadRequestException(
        plan === 'OPPORTUNITY'
          ? 'Missing STRIPE_PRICE_OPPORTUNITY env variable'
          : 'Missing STRIPE_PRICE_REVENUE env variable',
      );
    }

    return priceId;
  }

  private extractPaymentIntent(subscription: any): any {
    const latestInvoice = subscription.latest_invoice as any;
    if (!latestInvoice) return null;

    const paymentIntent = latestInvoice.payment_intent as any;
    if (!paymentIntent || typeof paymentIntent === 'string') return null;

    return paymentIntent;
  }

  private mapStripeSubscriptionStatus(status: any): SubscriptionStatus {
    switch (status) {
      case 'trialing':
        return SubscriptionStatus.TRIALING;
      case 'active':
        return SubscriptionStatus.ACTIVE;
      case 'past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
        return SubscriptionStatus.CANCELED;
      case 'unpaid':
        return SubscriptionStatus.PAST_DUE;
      case 'incomplete':
        return SubscriptionStatus.TRIALING;
      case 'incomplete_expired':
        return SubscriptionStatus.EXPIRED;
      case 'paused':
        return SubscriptionStatus.PAUSED;
      default:
        return SubscriptionStatus.TRIALING;
    }
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
        ]
          .filter(Boolean)
          .join('\n\n'),
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

  private async sendSubscriptionCreatedEmail(
    organizationId: string,
    input: { clientId: string; planName: string; amountCents: number; currencyCode: string },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, input.clientId);
    if (!recipient?.email) return;

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent: 'subscription_created',
        toEmail: recipient.email,
        toName: recipient.name,
        subject: `${input.planName} subscription started`,
        bodyText: [
          `Your ${input.planName} subscription has been started.`,
          `Amount: ${formatMoney(input.amountCents, input.currencyCode)} per month.`,
          `We’re preparing your account now.`,
          ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
        ].join('\n\n'),
      });
    } catch (error) {
      console.warn('[billing] Failed to send subscription created email', {
        organizationId,
        clientId: input.clientId,
        planName: input.planName,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async sendSubscriptionRenewedEmail(
    organizationId: string,
    input: { clientId: string; planName: string; amountCents: number; currencyCode: string; currentPeriodEnd?: Date },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, input.clientId);
    if (!recipient?.email) return;

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent: 'subscription_renewed',
        toEmail: recipient.email,
        toName: recipient.name,
        subject: `${input.planName} subscription is active`,
        bodyText: [
          `Your ${input.planName} subscription is active.`,
          `Amount: ${formatMoney(input.amountCents, input.currencyCode)} per month.`,
          input.currentPeriodEnd ? `Current period ends: ${input.currentPeriodEnd.toISOString()}.` : null,
          ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
    } catch (error) {
      console.warn('[billing] Failed to send subscription renewed email', {
        organizationId,
        clientId: input.clientId,
        planName: input.planName,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async sendPaymentFailedNotice(
    organizationId: string,
    input: { clientId: string; planName: string; amountCents: number; currencyCode: string },
  ) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, input.clientId);
    if (!recipient?.email) return;

    try {
      await this.emailsService.sendDirectEmail({
        emailEvent: 'payment_failed',
        toEmail: recipient.email,
        toName: recipient.name,
        subject: `${input.planName} payment issue`,
        bodyText: [
          `We could not process your latest payment for ${input.planName}.`,
          `Amount: ${formatMoney(input.amountCents, input.currencyCode)}.`,
          `Please update your payment method to avoid interruption.`,
          ORCHESTRATE_LEGAL_IDENTITY.relationshipStatement,
        ].join('\n\n'),
      });
    } catch (error) {
      console.warn('[billing] Failed to send payment failed email', {
        organizationId,
        clientId: input.clientId,
        planName: input.planName,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
  }

  private readUnixTimestamp(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
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
