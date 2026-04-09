export type PlanLane = 'opportunity' | 'revenue';
export type PlanTier = 'focused' | 'multi' | 'precision';

export interface PlanDefinition {
  lane: PlanLane;
  tier: PlanTier;
  stripePriceId: string;
  amountCents: number;
  currency: 'usd';
  interval: 'month';
  displayPrice: number;
  label: string;
  description: string;
}

const env = process.env;

export const PLAN_CATALOG: PlanDefinition[] = [
  // Opportunity
  {
    lane: 'opportunity',
    tier: 'focused',
    stripePriceId: env.STRIPE_PRICE_OPPORTUNITY_FOCUSED!,
    amountCents: 43500,
    currency: 'usd',
    interval: 'month',
    displayPrice: 435,
    label: 'Focused',
    description: 'Operate within a single country across multiple regions with structured outreach and follow-up.',
  },
  {
    lane: 'opportunity',
    tier: 'multi',
    stripePriceId: env.STRIPE_PRICE_OPPORTUNITY_MULTI!,
    amountCents: 64500,
    currency: 'usd',
    interval: 'month',
    displayPrice: 645,
    label: 'Multi',
    description: 'Operate across multiple countries with structured outreach and follow-up.',
  },
  {
    lane: 'opportunity',
    tier: 'precision',
    stripePriceId: env.STRIPE_PRICE_OPPORTUNITY_PRECISION!,
    amountCents: 97500,
    currency: 'usd',
    interval: 'month',
    displayPrice: 975,
    label: 'Precision',
    description: 'Advanced targeting with city-level precision and prioritized market execution.',
  },

  // Revenue
  {
    lane: 'revenue',
    tier: 'focused',
    stripePriceId: env.STRIPE_PRICE_REVENUE_FOCUSED!,
    amountCents: 87000,
    currency: 'usd',
    interval: 'month',
    displayPrice: 870,
    label: 'Focused',
    description: 'Operate within a single country across multiple regions.',
  },
  {
    lane: 'revenue',
    tier: 'multi',
    stripePriceId: env.STRIPE_PRICE_REVENUE_MULTI!,
    amountCents: 129000,
    currency: 'usd',
    interval: 'month',
    displayPrice: 1290,
    label: 'Multi',
    description: 'Operate across multiple countries with full outreach and billing support.',
  },
  {
    lane: 'revenue',
    tier: 'precision',
    stripePriceId: env.STRIPE_PRICE_REVENUE_PRECISION!,
    amountCents: 195000,
    currency: 'usd',
    interval: 'month',
    displayPrice: 1950,
    label: 'Precision',
    description: 'Advanced targeting with city-level precision and full operational control.',
  },
];