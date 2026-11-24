import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { agencies, pricingGroups, visaRates } from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import { getCompany, todayInCompanyTz } from "../services/settings.service";
import { badRequest, conflict, notFound, ok, parse } from "../utils/http";
import { uuidSchema } from "../utils/validation";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const money = z.coerce.number().min(0, "Cannot be negative").max(100_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

// ================================================================================
// Pricing groups
// ================================================================================
const groupSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Use capital letters, numbers and underscores, e.g. GOLD"),
    name: z.string().trim().min(2, "Name is required").max(100),
    description: optionalText(500),
    adjustmentType: z.enum(["percent", "fixed"]),
    adjustmentValue: z.coerce.number().min(-100_000_000).max(100_000_000),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((g) => g.adjustmentType !== "percent" || (g.adjustmentValue >= -100 && g.adjustmentValue <= 500), { path: ["adjustmentValue"], message: "Percentage must be between -100 and 500" });

/** GET /api/admin/pricing-groups */
export const listPricingGroups = async (_req: Request, res: Response) => {
  const rows = await db
    .select({ group: pricingGroups, agencyCount: sql<number>`(select count(*)::int from agencies a where a.pricing_group_id = "pricing_groups"."id")` })
    .from(pricingGroups)
    .orderBy(desc(pricingGroups.isDefault), asc(pricingGroups.name));
  ok(res, rows.map((r) => ({ ...r.group, agencyCount: r.agencyCount })));
};

async function saveGroup(id: string | null, data: z.infer<typeof groupSchema>) {
  const [dup] = await db.select({ id: pricingGroups.id }).from(pricingGroups).where(and(eq(pricingGroups.code, data.code), id ? ne(pricingGroups.id, id) : undefined)).limit(1);
  if (dup) throw conflict("A pricing group with this code already exists", [{ path: "code", message: "Code already in use" }]);
  if (data.isDefault && !data.isActive) throw badRequest("The default group must be active");
  return db.transaction(async (tx) => {
    // Only one default group.
    if (data.isDefault) await tx.update(pricingGroups).set({ isDefault: false }).where(id ? ne(pricingGroups.id, id) : undefined);
    const [row] = id ? await tx.update(pricingGroups).set(data).where(eq(pricingGroups.id, id)).returning() : await tx.insert(pricingGroups).values(data).returning();
    if (!row) throw notFound("Pricing group not found");
    await logAudit({ action: id ? "pricing.group_updated" : "pricing.group_created", entityType: "pricing_group", entityId: row.id, newValues: row }, tx);
    return row;
  });
}

export const createPricingGroup = async (req: Request, res: Response) => {
  ok(res, await saveGroup(null, parse(groupSchema, req.body)), "Pricing group added", 201);
};

export const updatePricingGroup = async (req: Request, res: Response) => {
  ok(res, await saveGroup(parse(uuidSchema, req.params.id), parse(groupSchema, req.body)), "Pricing group saved");
};

export const deletePricingGroup = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [used] = await db.select({ n: count() }).from(agencies).where(eq(agencies.pricingGroupId, id));
  if ((used?.n ?? 0) > 0) throw badRequest("Agencies are in this group. Move them to another group or make it inactive.");
  const [row] = await db.delete(pricingGroups).where(eq(pricingGroups.id, id)).returning();
  if (!row) throw notFound("Pricing group not found");
  await logAudit({ action: "pricing.group_deleted", entityType: "pricing_group", entityId: id, oldValues: row });
  ok(res, null, "Pricing group deleted");
};

// ================================================================================
// Agency commercial terms
// ================================================================================
const commercialSchema = z.object({
  pricingGroupId: uuidSchema.nullable(),
  agentCategory: optionalText(50),
});

/** PATCH /api/admin/agencies/:id/commercial */
export const updateAgencyCommercial = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(commercialSchema, req.body);
  const [before] = await db.select().from(agencies).where(eq(agencies.id, id));
  if (!before) throw notFound("Agency not found");
  if (data.pricingGroupId) {
    const [g] = await db.select({ id: pricingGroups.id }).from(pricingGroups).where(and(eq(pricingGroups.id, data.pricingGroupId), eq(pricingGroups.isActive, true)));
    if (!g) throw badRequest("Choose an active pricing group", [{ path: "pricingGroupId", message: "Not an active group" }]);
  }
  await db.transaction(async (tx) => {
    await tx.update(agencies).set({ ...data, version: sql`${agencies.version} + 1` }).where(eq(agencies.id, id));
    await logAudit({ action: "agency.commercial_updated", entityType: "agency", entityId: id, oldValues: { pricingGroupId: before.pricingGroupId, agentCategory: before.agentCategory }, newValues: data }, tx);
  });
  ok(res, data, "Pricing group and category saved");
};

// ================================================================================
// Visa rates (Umrah)
// ================================================================================
const visaSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    category: z.string().trim().min(1, "Category is required").max(80),
    visaFee: money,
    serviceFee: money.default(0),
    otherCharges: money.default(0),
    currency: z.string().trim().toUpperCase().length(3).optional(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional().transform((v) => v ?? null),
    isActive: z.boolean().default(true),
    notes: optionalText(1000),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { path: ["effectiveTo"], message: "End date must be on or after the start date" });

function rateState(r: { isActive: boolean; effectiveFrom: string; effectiveTo: string | null }, today: string) {
  if (!r.isActive) return "inactive";
  if (r.effectiveFrom > today) return "upcoming";
  if (r.effectiveTo && r.effectiveTo < today) return "expired";
  return "current";
}

/** GET /api/admin/visa-rates */
export const listVisaRates = async (_req: Request, res: Response) => {
  const today = await todayInCompanyTz();
  const rows = await db.select().from(visaRates).orderBy(asc(visaRates.category), desc(visaRates.effectiveFrom));
  ok(res, rows.map((r) => ({ ...r, total: Number(r.visaFee) + Number(r.serviceFee) + Number(r.otherCharges), state: rateState(r, today) })));
};

async function assertNoOverlap(id: string | null, v: z.infer<typeof visaSchema>) {
  if (!v.isActive) return;
  const others = await db
    .select()
    .from(visaRates)
    .where(and(eq(visaRates.name, v.name), eq(visaRates.category, v.category), eq(visaRates.isActive, true), id ? ne(visaRates.id, id) : undefined));
  const end = v.effectiveTo ?? "9999-12-31";
  const clash = others.find((o) => o.effectiveFrom <= end && (o.effectiveTo ?? "9999-12-31") >= v.effectiveFrom);
  if (clash) {
    throw badRequest(`Another active rate for ${v.name} (${v.category}) covers these dates (from ${clash.effectiveFrom}). End that rate first.`, [{ path: "effectiveFrom", message: "Dates overlap another rate" }]);
  }
}

export const createVisaRate = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const data = parse(visaSchema, req.body);
  await assertNoOverlap(null, data);
  const currency = data.currency ?? (await getCompany()).currency;
  const [row] = await db.insert(visaRates).values({ ...data, currency, createdBy: user.id }).returning();
  await logAudit({ action: "pricing.visa_rate_created", entityType: "visa_rate", entityId: row!.id, newValues: row });
  ok(res, row, "Visa rate added", 201);
};

/**
 * PATCH /api/admin/visa-rates/:id. To change the price of a rate already in use, end it (set the end date)
 * and add a new rate from the next day, so the old price stays in the history.
 */
export const updateVisaRate = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(visaSchema, req.body);
  const [before] = await db.select().from(visaRates).where(eq(visaRates.id, id));
  if (!before) throw notFound("Visa rate not found");
  const today = await todayInCompanyTz();
  const started = before.effectiveFrom <= today;
  const priceChanged = Number(before.visaFee) !== data.visaFee || Number(before.serviceFee) !== data.serviceFee || Number(before.otherCharges) !== data.otherCharges || before.effectiveFrom !== data.effectiveFrom;
  if (started && priceChanged) {
    throw badRequest("This rate is already in use. Set an end date on it and add a new rate instead, so the old price stays on record.");
  }
  await assertNoOverlap(id, data);
  const [row] = await db.update(visaRates).set({ ...data, currency: data.currency ?? before.currency }).where(eq(visaRates.id, id)).returning();
  await logAudit({ action: "pricing.visa_rate_updated", entityType: "visa_rate", entityId: id, oldValues: before, newValues: row });
  ok(res, row, "Visa rate saved");
};
