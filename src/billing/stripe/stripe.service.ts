import { BadRequestException, Injectable } from '@nestjs/common';
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
type CreateCheckoutSessionInput = {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  subscriptionMetadata?: Record<string, string>;
  trialDays?: number;
};

type SubscriptionPlanCode = 'OPPORTUNITY' | 'REVENUE';
type SubscriptionTierCode = 'FOCUSED' | 'MULTI' | 'PRECISION';

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

  async createCheckoutSession(input: CreateCheckoutSessionInput) {
    const normalizedTrialDays =
      typeof input.trialDays === 'number' && Number.isFinite(input.trialDays) && input.trialDays > 0
        ? Math.max(1, Math.min(30, Math.floor(input.trialDays)))
        : undefined;

    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      subscription_data: {
        metadata: input.subscriptionMetadata,
        ...(normalizedTrialDays ? { trial_period_days: normalizedTrialDays } : {}),
      },
      allow_promotion_codes: false,
    });
  }

  async createPortalSession(input: CreatePortalSessionInput) {
    return this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
  }

  async cancelSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  resolvePriceId(plan: SubscriptionPlanCode, tier: SubscriptionTierCode) {
    const envKey = `STRIPE_PRICE_${plan}_${tier}`;
    const priceId = process.env[envKey]?.trim();

    if (!priceId) {
      throw new BadRequestException(`Missing ${envKey} env variable`);
    }

    return priceId;
  }
}
