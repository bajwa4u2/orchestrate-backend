import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { BillingService } from '../billing.service';
import { StripeService } from './stripe.service';

@Controller('billing/webhook')
export class WebhookController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly billingService: BillingService,
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

    let event: Stripe.Event;

    try {
      event = this.stripeService
        .getClient()
        .webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? `Invalid Stripe webhook signature: ${error.message}` : 'Invalid Stripe webhook signature',
      );
    }

    switch (event.type) {
      case 'invoice.paid':
        await this.billingService.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await this.billingService.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted':
        await this.billingService.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      default:
        break;
    }

    return { received: true, type: event.type };
  }
}