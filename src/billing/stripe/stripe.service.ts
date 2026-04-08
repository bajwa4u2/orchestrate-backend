import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
    });
  }

  private resolvePriceId(plan: string, tier: string): string {
    if (plan === 'opportunity') {
      if (tier === 'focused') return process.env.STRIPE_PRICE_OPPORTUNITY_FOCUSED!;
      if (tier === 'multi') return process.env.STRIPE_PRICE_OPPORTUNITY_MULTI!;
      if (tier === 'precision') return process.env.STRIPE_PRICE_OPPORTUNITY_PRECISION!;
    }

    if (plan === 'revenue') {
      if (tier === 'focused') return process.env.STRIPE_PRICE_REVENUE_FOCUSED!;
      if (tier === 'multi') return process.env.STRIPE_PRICE_REVENUE_MULTI!;
      if (tier === 'precision') return process.env.STRIPE_PRICE_REVENUE_PRECISION!;
    }

    throw new Error('Invalid plan or tier');
  }

  async createCheckoutSession(
    plan: string,
    tier: string,
    customerEmail: string,
  ): Promise<string> {
    const priceId = this.resolvePriceId(plan, tier);

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: customerEmail,

      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],

      success_url: process.env.STRIPE_SUCCESS_URL!,
      cancel_url: process.env.STRIPE_CANCEL_URL!,

      metadata: {
        plan,
        tier,
      },
    });

    return session.url!;
  }
}