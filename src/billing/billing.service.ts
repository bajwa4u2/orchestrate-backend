import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityKind, ActivityVisibility, ArtifactLifecycle, InvoiceStatus, PaymentMethodType, PaymentStatus, Prisma, RecordSource, SubscriptionStatus, WorkflowLane, WorkflowStatus, WorkflowTrigger, WorkflowType } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { formatMoney } from '../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../financial-documents/legal-identity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { StripeService } from './stripe/stripe.service';
import { WorkflowsService } from '../workflows/workflows.service';

type CreateSubscriptionIntentInput = {
  organizationId: string;
  clientId: string;
  userId: string;
  email?: string;
  plan: 'OPPORTUNITY' | 'REVENUE';
  tier: 'FOCUSED' | 'MULTI' | 'PRECISION';
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
    private readonly workflowsService: WorkflowsService,
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
        where: {
          ...where,
          status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
        },
      }),
      this.prisma.invoice.count({
        where: {
          ...where,
          dueAt: { lt: now },
          status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
        },
      }),
      this.prisma.statement.count({ where: { ...where, status: { in: ['DRAFT', 'ISSUED'] } } }),
      this.prisma.subscription.count({
        where: {
          ...where,
          status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        },
      }),
      this.prisma.payment.count({ where: { ...where, status: PaymentStatus.SUCCEEDED } }),
      this.prisma.invoice.aggregate({
        where,
        _sum: { totalCents: true, amountPaidCents: true, balanceDueCents: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...where, status: PaymentStatus.SUCCEEDED },
        _sum: { amountCents: true },
      }),
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

    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: dto.clientId,
      subscriptionId: dto.subscriptionId ?? undefined,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.BILLING_CYCLE,
      status: WorkflowStatus.RUNNING,
      trigger: createdById ? WorkflowTrigger.MANUAL_OPERATOR : WorkflowTrigger.SYSTEM_EVENT,
      source: createdById ? RecordSource.OPERATOR_CREATED : RecordSource.SYSTEM_GENERATED,
      title: `Invoice ${invoiceNumber}`,
      inputJson: {
        invoiceNumber,
        lineCount: dto.lines.length,
        subtotalCents,
        taxCents,
        totalCents,
      },
      startedAt: new Date(),
    });

    const invoice = await this.prisma.invoice.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        subscriptionId: dto.subscriptionId,
        billingProfileId: dto.billingProfileId,
        createdById,
        workflowRunId: workflow.id,
        invoiceNumber,
        currencyCode: dto.currencyCode ?? client.currencyCode,
        status: dto.issuedAt ? InvoiceStatus.ISSUED : InvoiceStatus.DRAFT,
        source: createdById ? RecordSource.OPERATOR_CREATED : RecordSource.SYSTEM_GENERATED,
        lifecycle: dto.issuedAt ? ArtifactLifecycle.ISSUED : ArtifactLifecycle.DRAFT,
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

    await Promise.all([
      this.workflowsService.attachWorkflowSubjects(workflow.id, {
        invoiceId: invoice.id,
        title: `Invoice ${invoice.invoiceNumber}`,
        resultJson: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, totalCents },
      }),
      this.prisma.activityEvent.create({
        data: {
          organizationId,
          clientId: dto.clientId,
          actorUserId: createdById,
          workflowRunId: workflow.id,
          kind: ActivityKind.INVOICE_ISSUED,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'INVOICE',
          subjectId: invoice.id,
          summary: dto.issuedAt ? `Invoice ${invoice.invoiceNumber} issued.` : `Invoice ${invoice.invoiceNumber} drafted.`,
          metadataJson: toPrismaJson({ invoiceNumber: invoice.invoiceNumber, totalCents }),
        },
      }),
    ]);

    if (invoice.status === InvoiceStatus.ISSUED) {
      await this.workflowsService.completeWorkflowRun(workflow.id, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
      });
      await this.sendInvoiceIssuedEmail(organizationId, invoice);
    } else {
      await this.workflowsService.completeWorkflowRun(workflow.id, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
      });
    }

    return invoice;
  }

  async recordPayment(organizationId: string, actorUserId: string | undefined, dto: RecordPaymentDto) {
    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: dto.clientId,
      invoiceId: dto.invoiceId ?? undefined,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.PAYMENT_COLLECTION,
      status: WorkflowStatus.RUNNING,
      trigger: actorUserId ? WorkflowTrigger.MANUAL_OPERATOR : WorkflowTrigger.PAYMENT_EVENT,
      source: dto.method === PaymentMethodType.STRIPE ? RecordSource.EXTERNAL_SYNC : RecordSource.SYSTEM_GENERATED,
      title: 'Payment collection',
      inputJson: { amountCents: dto.amountCents, method: dto.method, invoiceId: dto.invoiceId ?? null },
      startedAt: new Date(),
    });

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
        metadataJson: toPrismaJson({ ...(dto.metadataJson ?? {}), actorUserId, workflowRunId: workflow.id }),
      },
      include: { invoice: true, client: true },
    });

    let receiptNumber: string | null = null;

    if (dto.invoiceId && (dto.status ?? PaymentStatus.SUCCEEDED) === PaymentStatus.SUCCEEDED) {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: dto.invoiceId, organizationId },
        select: { id: true, totalCents: true, amountPaidCents: true, invoiceNumber: true, workflowRunId: true },
      });

      if (invoice) {
        const amountPaidCents = invoice.amountPaidCents + dto.amountCents;
        const balanceDueCents = Math.max(invoice.totalCents - amountPaidCents, 0);
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaidCents,
            balanceDueCents,
            lifecycle: amountPaidCents >= invoice.totalCents ? ArtifactLifecycle.ACKNOWLEDGED : ArtifactLifecycle.ISSUED,
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
            workflowRunId: workflow.id,
            receiptNumber: await this.generateReceiptNumber(organizationId),
            source: RecordSource.SYSTEM_GENERATED,
            lifecycle: ArtifactLifecycle.ISSUED,
            currencyCode: payment.currencyCode,
            amountCents: payment.amountCents,
            issuedAt: payment.receivedAt ?? new Date(),
            metadataJson: { source: 'payment-recorded', actorUserId } as Prisma.InputJsonValue,
          },
        });
        receiptNumber = receipt.receiptNumber;

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

    await Promise.all([
      this.workflowsService.completeWorkflowRun(workflow.id, {
        paymentId: payment.id,
        invoiceId: dto.invoiceId ?? null,
        receiptNumber,
        amountCents: payment.amountCents,
        status: payment.status,
      }),
      this.prisma.activityEvent.create({
        data: {
          organizationId,
          clientId: dto.clientId,
          actorUserId,
          workflowRunId: workflow.id,
          kind: ActivityKind.PAYMENT_RECEIVED,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'PAYMENT',
          subjectId: payment.id,
          summary: 'Payment received.',
          metadataJson: toPrismaJson({ amountCents: payment.amountCents, receiptNumber, invoiceId: dto.invoiceId ?? null }),
        },
      }),
    ]);

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
        checkoutUrl: null,
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
        trial: {
          eligible: false,
          applied: existingSubscription.status === SubscriptionStatus.TRIALING,
          days:
            this.resolveConfiguredTrialDays() > 0
              ? this.resolveConfiguredTrialDays()
              : null,
        },
      };
    }

    const configuredTrialDays = this.resolveConfiguredTrialDays();
    const trialEligible =
      configuredTrialDays > 0 &&
      (await this.isClientEligibleForTrial(input.organizationId, input.clientId));

    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: input.clientId,
      lane: WorkflowLane.ACTIVATION,
      type: WorkflowType.SUBSCRIPTION_ACTIVATION,
      status: WorkflowStatus.RUNNING,
      trigger: WorkflowTrigger.USER_ACTION,
      source: RecordSource.USER_CREATED,
      title: 'Subscription activation',
      inputJson: { plan: input.plan, tier: input.tier },
      startedAt: new Date(),
    });

    const plan = await this.resolvePlan(input.organizationId, input.plan, input.tier);
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
          tierCode: input.tier,
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

    const baseUrl =
      process.env.CLIENT_BASE_URL?.trim() ||
      process.env.CLIENT_PORTAL_BASE_URL?.trim();

    if (!baseUrl) {
      throw new BadRequestException('Missing CLIENT_BASE_URL environment variable');
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

    const trialDays = trialEligible ? configuredTrialDays : undefined;

    const checkoutSession = await this.stripeService.createCheckoutSession({
      customerId: stripeCustomerId,
      priceId: this.stripeService.resolvePriceId(input.plan, input.tier),
      successUrl: `${normalizedBaseUrl}/client/workspace?billing=success${trialDays ? '&trial=1' : ''}`,
      cancelUrl: `${normalizedBaseUrl}/client/subscribe?plan=${input.plan.toLowerCase()}&tier=${input.tier.toLowerCase()}&canceled=1`,
      metadata: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        planCode: plan.code,
        tierCode: input.tier,
        trialApplied: trialDays ? 'true' : 'false',
        trialDays: trialDays ? String(trialDays) : '0',
      },
      subscriptionMetadata: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        planCode: plan.code,
        tierCode: input.tier,
        createdByUserId: input.userId,
        trialApplied: trialDays ? 'true' : 'false',
        trialDays: trialDays ? String(trialDays) : '0',
      },
      trialDays,
    });

    if (!checkoutSession.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }

    await this.prisma.client.update({
      where: { id: client.id },
      data: {
        metadataJson: toPrismaJson({
          ...this.asObject(client.metadataJson),
          billing: {
            ...billingMetadata,
            stripeCustomerId,
            stripeCheckoutSessionId: checkoutSession.id,
            stripeCheckoutPreparedAt: new Date().toISOString(),
            trial: {
              eligible: trialEligible,
              prepared: Boolean(trialDays),
              applied: false,
              days: trialDays ?? 0,
              lastPreparedAt: new Date().toISOString(),
            },
          },
        }),
      },
    });

    await this.sendSubscriptionCreatedEmail(input.organizationId, {
      clientId: input.clientId,
      planName: plan.name,
      amountCents: plan.amountCents,
      currencyCode: plan.currencyCode ?? 'USD',
    });

    await this.workflowsService.completeWorkflowRun(workflow.id, {
      checkoutUrlCreated: true,
      planCode: plan.code,
      tier: input.tier,
      stripeCustomerId,
      trialEligible,
      trialApplied: Boolean(trialDays),
      trialDays: trialDays ?? 0,
    });

    return {
      checkoutUrl: checkoutSession.url,
      alreadyExists: false,
      plan: {
        code: plan.code,
        name: plan.name,
        amountCents: plan.amountCents,
        currencyCode: plan.currencyCode,
        interval: plan.interval,
      },
      trial: {
        eligible: trialEligible,
        applied: Boolean(trialDays),
        days: trialDays ?? null,
      },
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
          in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
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

    const subscriptionMetadata = this.asObject(subscription.metadataJson);

    return {
      plan: subscription.plan?.name ?? null,
      planCode: subscription.plan?.code ?? null,
      tier: this.readString(subscriptionMetadata.tierCode) ?? null,
      status: subscription.status,
      amount: subscription.amountCents / 100,
      currency: subscription.currencyCode,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      isTrialing: subscription.status === SubscriptionStatus.TRIALING,
      trialStartedAt:
        subscription.status === SubscriptionStatus.TRIALING ? subscription.currentPeriodStart : null,
      trialEndsAt:
        subscription.status === SubscriptionStatus.TRIALING ? subscription.currentPeriodEnd : null,
      trialDays:
        this.readNumber(subscriptionMetadata.trialDays) ??
        this.readNumber(this.asObject(subscriptionMetadata.trial ?? null).days) ??
        null,
    };
  }

  async handleInvoicePaid(invoice: any) {
    const stripeSubscriptionId =
      typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
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
      const workflow = await this.workflowsService.createWorkflowRun({
        clientId: subscription.clientId,
        subscriptionId: subscription.id,
        lane: WorkflowLane.REVENUE,
        type: WorkflowType.PAYMENT_COLLECTION,
        status: WorkflowStatus.RUNNING,
        trigger: WorkflowTrigger.PAYMENT_EVENT,
        source: RecordSource.EXTERNAL_SYNC,
        title: 'Stripe invoice paid',
        inputJson: { stripeInvoiceId: invoice.id, stripeSubscriptionId, amountCents: invoiceAmountCents },
        startedAt: new Date(),
      });
      const payment = await this.prisma.payment.create({
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
            workflowRunId: workflow.id,
          }),
        },
      });
      await this.prisma.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          workflowRunId: workflow.id,
          status: PaymentStatus.SUCCEEDED,
          source: RecordSource.EXTERNAL_SYNC,
          gatewayMessage: 'Stripe webhook invoice.paid',
          metadataJson: toPrismaJson({ stripeInvoiceId: invoice.id }),
        },
      });
      await this.workflowsService.completeWorkflowRun(workflow.id, {
        paymentId: payment.id,
        stripeInvoiceId: invoice.id,
        amountCents: invoiceAmountCents,
      });
    }

    if ((invoice.amount_paid ?? 0) > 0) {
      await this.sendSubscriptionRenewedEmail(subscription.organizationId, {
        clientId: subscription.clientId,
        planName: subscription.plan?.name ?? 'Subscription',
        amountCents: subscription.amountCents,
        currencyCode: subscription.currencyCode,
        currentPeriodEnd: subscription.currentPeriodEnd ?? undefined,
      });
    }

    return { ok: true };
  }

  async handlePaymentFailed(invoice: any) {
    const stripeSubscriptionId =
      typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (!stripeSubscriptionId) return { ok: true };

    const subscription = await this.prisma.subscription.findFirst({
      where: { externalRef: stripeSubscriptionId },
      include: { plan: true },
    });

    if (!subscription) return { ok: true };

    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: subscription.clientId,
      subscriptionId: subscription.id,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.PAYMENT_COLLECTION,
      status: WorkflowStatus.RUNNING,
      trigger: WorkflowTrigger.PAYMENT_EVENT,
      source: RecordSource.EXTERNAL_SYNC,
      title: 'Stripe payment failed',
      inputJson: { stripeInvoiceId: invoice.id, stripeSubscriptionId },
      startedAt: new Date(),
    });

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

    await this.workflowsService.completeWorkflowRun(workflow.id, {
      stripeInvoiceId: invoice.id,
      status: 'PAST_DUE',
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
    let subscription = await this.prisma.subscription.findFirst({
      where: { externalRef: stripeSubscription.id },
    });

    if (!subscription) {
      const metadata = this.asObject(stripeSubscription.metadata);
      const organizationId = this.readString(metadata.organizationId);
      const clientId = this.readString(metadata.clientId);
      const planCode = this.readString(metadata.planCode);
      const tierCode = this.readString(metadata.tierCode);

      if (!organizationId || !clientId || !planCode) {
        return { ok: true };
      }

      const plan = await this.prisma.plan.findFirst({
        where: { organizationId, code: planCode },
      });

      if (!plan) {
        return { ok: true };
      }

      await this.prisma.subscription.create({
        data: {
          organizationId,
          clientId,
          planId: plan.id,
          externalRef: stripeSubscription.id,
          status: this.mapStripeSubscriptionStatus(stripeSubscription.status),
          amountCents: plan.amountCents,
          currencyCode: plan.currencyCode ?? 'USD',
          billingAnchorAt:
            this.readUnixTimestamp(stripeSubscription.billing_cycle_anchor) ??
            this.readUnixTimestamp(stripeSubscription.current_period_start) ??
            new Date(),
          currentPeriodStart:
            this.readUnixTimestamp(stripeSubscription.trial_start) ??
            this.readUnixTimestamp(stripeSubscription.current_period_start),
          currentPeriodEnd:
            this.readUnixTimestamp(stripeSubscription.trial_end) ??
            this.readUnixTimestamp(stripeSubscription.current_period_end),
          canceledAt: stripeSubscription.canceled_at
            ? this.readUnixTimestamp(stripeSubscription.canceled_at) ?? new Date()
            : null,
          metadataJson: toPrismaJson({
            source: 'stripe',
            planCode: plan.code,
            stripeCustomerId:
              typeof stripeSubscription.customer === 'string'
                ? stripeSubscription.customer
                : stripeSubscription.customer?.id,
            stripeSubscriptionId: stripeSubscription.id,
            stripeSubscriptionStatus: stripeSubscription.status,
            cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
            tierCode: tierCode ?? null,
            trialApplied: Boolean(stripeSubscription.trial_end),
            trialDays:
              this.readNumber(this.asObject(stripeSubscription.metadata).trialDays) ??
              this.resolveTrialDaysFromStripe(stripeSubscription),
            trialStart:
              this.readUnixTimestamp(stripeSubscription.trial_start)?.toISOString() ?? null,
            trialEnd:
              this.readUnixTimestamp(stripeSubscription.trial_end)?.toISOString() ?? null,
          }),
        },
      });

      return { ok: true };
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: this.mapStripeSubscriptionStatus(stripeSubscription.status),
        currentPeriodStart:
          this.readUnixTimestamp(stripeSubscription.trial_start) ??
          this.readUnixTimestamp(stripeSubscription.current_period_start) ??
          subscription.currentPeriodStart,
        currentPeriodEnd:
          this.readUnixTimestamp(stripeSubscription.trial_end) ??
          this.readUnixTimestamp(stripeSubscription.current_period_end) ??
          subscription.currentPeriodEnd,
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
          tierCode:
            this.readString(this.asObject(stripeSubscription.metadata).tierCode) ??
            this.readString(this.asObject(subscription.metadataJson).tierCode) ??
            null,
          trialApplied: Boolean(stripeSubscription.trial_end),
          trialDays:
            this.readNumber(this.asObject(stripeSubscription.metadata).trialDays) ??
            this.readNumber(this.asObject(subscription.metadataJson).trialDays) ??
            this.resolveTrialDaysFromStripe(stripeSubscription),
          trialStart:
            this.readUnixTimestamp(stripeSubscription.trial_start)?.toISOString() ??
            this.readString(this.asObject(subscription.metadataJson).trialStart) ??
            null,
          trialEnd:
            this.readUnixTimestamp(stripeSubscription.trial_end)?.toISOString() ??
            this.readString(this.asObject(subscription.metadataJson).trialEnd) ??
            null,
        }),
      },
    });

    return { ok: true };
  }

  async handleTrialWillEnd(stripeSubscription: any) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { externalRef: stripeSubscription.id },
      include: { plan: true, client: true },
    });

    if (!subscription) return { ok: true };

    const trialEnd = this.readUnixTimestamp(stripeSubscription.trial_end) ?? subscription.currentPeriodEnd;
    const recipientEmail = await this.resolveClientEmail(subscription.organizationId, subscription.clientId);

    if (!recipientEmail) return { ok: true };

    const planName = subscription.plan?.name ?? 'Subscription';
    const amountText = formatMoney(subscription.amountCents, subscription.currencyCode);

    await this.emailsService.sendDirectEmail({
      toEmail: recipientEmail,
      toName: subscription.client?.displayName ?? undefined,
      category: 'billing',
      subject: 'Your trial is ending soon',
      bodyText: [
        `Your ${planName} trial with Orchestrate will end on ${trialEnd ? trialEnd.toUTCString() : 'the scheduled billing date'}.`,
        `When the trial ends, billing will begin at ${amountText} per month unless you cancel before then.`,
        `You can manage or cancel your subscription from the billing portal at any time.`,
      ].join('\n\n'),
      bodyHtml: [
        `<p>Your <strong>${planName}</strong> trial with Orchestrate will end on <strong>${trialEnd ? trialEnd.toUTCString() : 'the scheduled billing date'}</strong>.</p>`,
        `<p>When the trial ends, billing will begin at <strong>${amountText} per month</strong> unless you cancel before then.</p>`,
        `<p>You can manage or cancel your subscription from the billing portal at any time.</p>`,
      ].join(''),
      replyToEmail: process.env.EMAIL_REPLY_TO_SUPPORT?.trim() || 'support@orchestrateops.com',
      templateVariables: {
        plan_name: planName,
        trial_end: trialEnd?.toISOString() ?? null,
        amount_text: amountText,
      },
    });

    return { ok: true };
  }

  private async isClientEligibleForTrial(organizationId: string, clientId: string) {
    const subscriptionCount = await this.prisma.subscription.count({
      where: {
        organizationId,
        clientId,
      },
    });

    if (subscriptionCount > 0) {
      return false;
    }

    const client = await this.prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { metadataJson: true },
    });

    if (!client) {
      return false;
    }

    const billingMetadata = this.asObject(this.asObject(client.metadataJson).billing as Prisma.JsonValue);
    const priorTrialApplied = this.readBoolean(this.asObject(billingMetadata.trial as Prisma.JsonValue).applied);

    return !priorTrialApplied;
  }

  private resolveConfiguredTrialDays() {
    const raw = process.env.STRIPE_TRIAL_DAYS?.trim();
    if (!raw) return 15;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;

    return Math.max(1, Math.min(30, Math.floor(parsed)));
  }

  private resolveTrialDaysFromStripe(stripeSubscription: any) {
    const trialStart = this.readUnixTimestamp(stripeSubscription.trial_start);
    const trialEnd = this.readUnixTimestamp(stripeSubscription.trial_end);

    if (!trialStart || !trialEnd) {
      return null;
    }

    const diffMs = trialEnd.getTime() - trialStart.getTime();
    if (diffMs <= 0) {
      return null;
    }

    return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  private async resolvePlan(
    organizationId: string,
    plan: 'OPPORTUNITY' | 'REVENUE',
    tier: 'FOCUSED' | 'MULTI' | 'PRECISION',
  ) {
    const desiredCode = `${plan}_${tier}_MONTHLY`;

    const existing = await this.prisma.plan.findFirst({
      where: { organizationId, code: desiredCode, isActive: true },
    });

    if (existing) return existing;

    const isOpportunity = plan === 'OPPORTUNITY';
    const namePrefix = isOpportunity ? 'Opportunity' : 'Revenue';

    const tierLabel =
      tier === 'FOCUSED'
        ? 'Focused'
        : tier === 'MULTI'
          ? 'Multi-Market'
          : 'Precision';

    const description = isOpportunity
      ? tier === 'FOCUSED'
        ? 'Operate within a single country across multiple regions with structured outreach and follow-up.'
        : tier === 'MULTI'
          ? 'Operate across multiple countries with structured outreach and follow-up.'
          : 'Advanced targeting with city-level precision and prioritized market execution.'
      : tier === 'FOCUSED'
        ? 'Operate within a single country across multiple regions with full outreach and billing support.'
        : tier === 'MULTI'
          ? 'Operate across multiple countries with full outreach and billing support.'
          : 'Advanced targeting with city-level precision and full operational control.';

    const amountCents = this.resolvePlanAmountCents(plan, tier);

    const featuresJson = isOpportunity
      ? {
          positioning:
            tier === 'FOCUSED'
              ? 'Operate within one country and scale across regions.'
              : tier === 'MULTI'
                ? 'Run outreach across multiple countries with one operating system.'
                : 'Direct outreach with city-level precision and market priority control.',
          scope: [
            'lead sourcing',
            'outreach execution',
            'follow-ups',
            'meeting booking',
          ],
          coverage: this.resolveCoverageFeatures(tier),
        }
      : {
          positioning:
            tier === 'FOCUSED'
              ? 'Operate within one country with billing and collection continuity.'
              : tier === 'MULTI'
                ? 'Run outreach and billing operations across multiple countries.'
                : 'Direct outreach and billing with precision market control.',
          scope: [
            'lead sourcing',
            'outreach execution',
            'follow-ups',
            'meeting booking',
            'invoices',
            'payment tracking',
            'agreements',
            'statements',
          ],
          coverage: this.resolveCoverageFeatures(tier),
        };

    return this.prisma.plan.create({
      data: {
        organizationId,
        code: desiredCode,
        name: `${namePrefix} ${tierLabel}`,
        description,
        amountCents,
        currencyCode: 'USD',
        interval: 'MONTHLY' as const,
        featuresJson,
      },
    });
  }

  private resolvePlanAmountCents(plan: 'OPPORTUNITY' | 'REVENUE', tier: 'FOCUSED' | 'MULTI' | 'PRECISION') {
    if (plan === 'OPPORTUNITY') {
      if (tier === 'FOCUSED') return 43500;
      if (tier === 'MULTI') return 64500;
      return 97500;
    }

    if (tier === 'FOCUSED') return 87000;
    if (tier === 'MULTI') return 129000;
    return 195000;
  }

  private resolveCoverageFeatures(tier: 'FOCUSED' | 'MULTI' | 'PRECISION') {
    if (tier === 'FOCUSED') {
      return {
        countries: 1,
        regions: 'multiple',
        cityTargeting: false,
        includeExcludeGeography: false,
        marketPriorityOrder: false,
      };
    }

    if (tier === 'MULTI') {
      return {
        countries: 'multiple',
        regions: 'multiple',
        cityTargeting: false,
        includeExcludeGeography: false,
        marketPriorityOrder: false,
      };
    }

    return {
      countries: 'multiple',
      regions: 'multiple',
      cityTargeting: true,
      includeExcludeGeography: true,
      marketPriorityOrder: true,
    };
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
    invoice: {
      clientId: string;
      client?: { displayName?: string | null } | null;
      invoiceNumber: string;
      totalCents: number;
      currencyCode: string;
      dueAt?: Date | null;
    },
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
    input: {
      clientId: string;
      invoiceNumber?: string | null;
      receiptNumber: string;
      amountCents: number;
      currencyCode: string;
      receivedAt: Date;
    },
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
    input: {
      clientId: string;
      planName: string;
      amountCents: number;
      currencyCode: string;
      currentPeriodEnd?: Date;
    },
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

  private async resolveClientEmail(organizationId: string, clientId: string) {
    const recipient = await this.emailsService.resolveClientRecipient(organizationId, clientId);
    return recipient?.email ?? null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private readBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    if (typeof value === 'number') return value === 1;
    return false;
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