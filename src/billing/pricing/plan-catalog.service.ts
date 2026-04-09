import { PLAN_CATALOG, PlanLane, PlanTier } from './plan-catalog';

export function getPlan(lane: PlanLane, tier: PlanTier) {
  return PLAN_CATALOG.find(
    (p) => p.lane === lane && p.tier === tier,
  );
}

export function getPlanByStripePriceId(priceId: string) {
  return PLAN_CATALOG.find(
    (p) => p.stripePriceId === priceId,
  );
}

export function getAllPlans() {
  return PLAN_CATALOG;
}

export function getPlansGrouped() {
  return {
    opportunity: PLAN_CATALOG.filter(p => p.lane === 'opportunity'),
    revenue: PLAN_CATALOG.filter(p => p.lane === 'revenue'),
  };
}