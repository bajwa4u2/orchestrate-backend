import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Request } from 'express';
import { BillingService } from '../billing.service';
import { StripeService } from './stripe.service';

@Controller('billing/webhook')
export class WebhookController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') stripeSignature?: string,
  ) {
    if (!stripeSignature) {
      throw new BadRequestException('Missing Stripe signature');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      throw new BadRequestException('Missing STRIPE_WEBHOOK_SECRET environment variable');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body for Stripe webhook verification');
    }

    let event: any;

    try {
      event = this.stripeService
        .getClient()
        .webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    const existing = await this.prisma.webhookEventReceipt.findUnique({
      where: {
        provider_eventId: {
          provider: 'stripe',
          eventId: String(event.id),
        },
      },
    });

    if (existing?.processedAt) {
      return { received: true, type: event.type, duplicate: true };
    }

    const receipt = existing
      ? await this.prisma.webhookEventReceipt.update({
          where: { id: existing.id },
          data: {
            eventType: String(event.type),
            payloadJson: event as object,
            errorMessage: null,
          },
        })
      : await this.prisma.webhookEventReceipt.create({
          data: {
            provider: 'stripe',
            eventId: String(event.id),
            eventType: String(event.type),
            status: 'received',
            payloadJson: event as object,
          },
        });

    try {
      switch (event.type) {
        case 'invoice.paid':
          await this.billingService.handleInvoicePaid(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.billingService.handlePaymentFailed(event.data.object);
          break;

        case 'customer.subscription.updated':
        case 'customer.subscription.created':
        case 'customer.subscription.deleted':
          await this.billingService.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.trial_will_end':
          await this.billingService.handleTrialWillEnd(event.data.object);
          break;

        default:
          break;
      }

      await this.prisma.webhookEventReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'processed',
          processedAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      await this.prisma.webhookEventReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown webhook processing error',
        },
      });
      throw error;
    }

    return { received: true, type: event.type };
  }
}
