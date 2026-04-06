import { Injectable } from '@nestjs/common';
const Stripe = require('stripe');

type CreateCustomerInput = {
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
};

type CreateSubscriptionInput = {
  customerId: string;
  priceId: string;
  metadata?: Record<string, string>;
};

type CreatePortalSessionInput = {
  customerId: string;
  returnUrl: string;
};

@Injectable()
export class StripeService {
  private readonly stripe: any;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error('Missing STRIPE_SECRET_KEY environment variable');
    }

    this.stripe = new Stripe(secretKey);
  }

  getClient() {
    return this.stripe;
  }

  async createCustomer(input: CreateCustomerInput) {
    return this.stripe.customers.create({
      email: input.email,
      name: input.name,
      metadata: input.metadata,
    });
  }

  async createSubscription(input: CreateSubscriptionInput) {
    return this.stripe.subscriptions.create({
      customer: input.customerId,
      items: [{ price: input.priceId }],
      metadata: input.metadata,
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });
  }

  async createPortalSession(input: CreatePortalSessionInput) {
    return this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
  }
}
