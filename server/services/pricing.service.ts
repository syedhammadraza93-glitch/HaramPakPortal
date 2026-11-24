import { and, eq, inArray } from "drizzle-orm";
import { db } from "../database/connection";
import { agencies, agencyRateOverrides, pricingGroups, type PricingGroup } from "../database/schema";

/** Prices are shown and charged in whole rupees. */
export const roundPrice = (n: number) => Math.round(n);

export function applyGroup(base: number, group: Pick<PricingGroup, "adjustmentType" | "adjustmentValue"> | null): number {
  if (!group || !group.adjustmentValue) return roundPrice(base);
  const value = Number(group.adjustmentValue);
  const price = group.adjustmentType === "percent" ? base * (1 + value / 100) : base + value;
  return roundPrice(Math.max(0, price));
}

/** The agency's pricing group, or the default group when the agency has none (null = base prices). */
export async function groupForAgency(agencyId: string): Promise<PricingGroup | null> {
  const [row] = await db
    .select({ group: pricingGroups })
    .from(agencies)
    .leftJoin(pricingGroups, and(eq(pricingGroups.id, agencies.pricingGroupId), eq(pricingGroups.isActive, true)))
    .where(eq(agencies.id, agencyId))
    .limit(1);
  if (row?.group) return row.group;
  const [fallback] = await db.select().from(pricingGroups).where(and(eq(pricingGroups.isDefault, true), eq(pricingGroups.isActive, true))).limit(1);
  return fallback ?? null;
}

export interface AgencyPricer {
  /** Agent price for a rate: agency special price, else the group adjustment on the base price. */
  price(rate: { id: string; basePrice: number }): number;
}

/** Loads everything needed to price these rates for one agency (two queries). */
export async function pricerForAgency(agencyId: string, rateIds: string[]): Promise<AgencyPricer> {
  const [group, overrides] = await Promise.all([
    groupForAgency(agencyId),
    rateIds.length
      ? db
          .select({ rateId: agencyRateOverrides.rateId, price: agencyRateOverrides.price })
          .from(agencyRateOverrides)
          .where(and(eq(agencyRateOverrides.agencyId, agencyId), inArray(agencyRateOverrides.rateId, rateIds)))
      : Promise.resolve([]),
  ]);
  const special = new Map(overrides.map((o) => [o.rateId, Number(o.price)]));
  return {
    price: (rate) => (special.has(rate.id) ? roundPrice(special.get(rate.id)!) : applyGroup(Number(rate.basePrice), group)),
  };
}
