import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, type DbClient } from "../database/connection";
import { chargeRules, packageAddons, packageRates, type Package } from "../database/schema";
import { pricerForAgency, roundPrice } from "./pricing.service";

const ROOM_LABEL: Record<string, string> = { sharing: "Sharing", quad: "Quad", triple: "Triple", double: "Double", single: "Single" };
const PAX_LABEL: Record<string, string> = { adult: "Adult", child_with_bed: "Child with bed", child_no_bed: "Child without bed", infant: "Infant" };
export const fareLabel = (room: string | null, pax: string) => `${room ? `${ROOM_LABEL[room]} room · ` : ""}${PAX_LABEL[pax]}`;

export interface PriceLine {
  kind: "fare" | "addon" | "charge" | "quotation" | "adjustment";
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface Quote {
  lines: PriceLine[];
  subtotal: number;
  chargesTotal: number;
  total: number;
  /** Passengers or add-ons that have no price (the booking cannot be submitted). */
  problems: string[];
}

/**
 * Works out the agency's price for a booking: fares per passenger (a departure price wins over the general price),
 * chosen add-ons, then the taxes and charges set up by the admin.
 */
export async function priceBooking(
  input: {
    agencyId: string;
    pkg: Package;
    departureId: string | null;
    passengers: { paxType: string; roomType: string | null }[];
    addons: { addonId: string; quantity: number }[];
  },
  client: DbClient = db,
): Promise<Quote> {
  const [rates, addons, charges] = await Promise.all([
    client
      .select()
      .from(packageRates)
      .where(and(eq(packageRates.packageId, input.pkg.id), eq(packageRates.isActive, true), input.departureId ? or(isNull(packageRates.departureId), eq(packageRates.departureId, input.departureId)) : isNull(packageRates.departureId))),
    client.select().from(packageAddons).where(and(eq(packageAddons.packageId, input.pkg.id), eq(packageAddons.isActive, true))),
    client
      .select()
      .from(chargeRules)
      .where(and(eq(chargeRules.isActive, true), or(isNull(chargeRules.vertical), eq(chargeRules.vertical, input.pkg.vertical))))
      .orderBy(asc(chargeRules.sortOrder), asc(chargeRules.name)),
  ]);
  const pricer = await pricerForAgency(input.agencyId, rates.map((r) => r.id));
  const problems: string[] = [];
  const lines: PriceLine[] = [];

  // Fares, grouped by room type and passenger type
  const groups = new Map<string, { room: string | null; pax: string; count: number }>();
  for (const p of input.passengers) {
    const key = `${p.roomType}|${p.paxType}`;
    groups.set(key, { room: p.roomType, pax: p.paxType, count: (groups.get(key)?.count ?? 0) + 1 });
  }
  for (const g of groups.values()) {
    const match = (depId: string | null) =>
      rates.find((r) => r.departureId === depId && r.paxType === g.pax && (g.room ? r.roomType === g.room : true));
    const rate = (input.departureId && match(input.departureId)) || match(null);
    if (!rate) {
      problems.push(`No price for ${fareLabel(g.room, g.pax)}`);
      continue;
    }
    const unit = pricer.price(rate);
    lines.push({ kind: "fare", description: fareLabel(rate.roomType, g.pax), quantity: g.count, unitAmount: unit, amount: unit * g.count });
  }

  // Add-ons
  const paxCount = input.passengers.length;
  for (const chosen of input.addons) {
    const a = addons.find((x) => x.id === chosen.addonId);
    if (!a) {
      problems.push("A chosen add-on is no longer available");
      continue;
    }
    const qty = a.basis === "per_booking" ? 1 : Math.max(1, Math.min(chosen.quantity, paxCount || 1));
    const unit = roundPrice(Number(a.price));
    lines.push({ kind: "addon", description: `${a.name}${a.basis === "per_booking" ? " (per booking)" : ""}`, quantity: qty, unitAmount: unit, amount: unit * qty });
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  // Taxes and charges
  for (const c of charges) {
    const value = Number(c.value);
    if (c.chargeType === "percent") {
      const amount = roundPrice((subtotal * value) / 100);
      lines.push({ kind: "charge", description: `${c.name} (${value}%)`, quantity: 1, unitAmount: amount, amount });
    } else if (c.basis === "per_person") {
      const unit = roundPrice(value);
      lines.push({ kind: "charge", description: c.name, quantity: paxCount, unitAmount: unit, amount: unit * paxCount });
    } else {
      const unit = roundPrice(value);
      lines.push({ kind: "charge", description: c.name, quantity: 1, unitAmount: unit, amount: unit });
    }
  }
  const chargesTotal = lines.filter((l) => l.kind === "charge").reduce((s, l) => s + l.amount, 0);
  return { lines, subtotal, chargesTotal, total: subtotal + chargesTotal, problems };
}
