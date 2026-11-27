import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import {
  cancellationPolicies, cancellationSlabs, destinations, documentRequirements, hotels, packageHotels, packages, verticalEnum,
} from "../database/schema";
import { logAudit } from "../services/audit.service";
import { badRequest, conflict, notFound, ok, parse } from "../utils/http";
import { uuidSchema } from "../utils/validation";

const vertical = z.enum(verticalEnum.enumValues);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const optionalInt = (min: number, max: number) =>
  z.union([z.coerce.number().int().min(min).max(max), z.literal(""), z.null()]).optional().transform((v) => (v === "" || v === undefined ? null : v));

// ================================================================================
// Destinations
// ================================================================================
const destinationSchema = z.object({
  country: z.string().trim().min(2, "Country is required").max(80),
  city: z.string().trim().min(2, "City is required").max(80),
  verticals: z.array(vertical).min(1, "Choose at least one product type"),
  description: optionalText(1000),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const listDestinations = async (req: Request, res: Response) => {
  const v = req.query.vertical ? parse(vertical, req.query.vertical) : null;
  const rows = await db
    .select({ destination: destinations, hotelCount: sql<number>`(select count(*)::int from hotels h where h.destination_id = "destinations"."id")` })
    .from(destinations)
    .where(v ? sql`${destinations.verticals} @> ${JSON.stringify([v])}::jsonb` : undefined)
    .orderBy(asc(destinations.sortOrder), asc(destinations.country), asc(destinations.city));
  ok(res, rows.map((r) => ({ ...r.destination, hotelCount: r.hotelCount })));
};

export const createDestination = async (req: Request, res: Response) => {
  const data = parse(destinationSchema, req.body);
  const [dup] = await db.select({ id: destinations.id }).from(destinations).where(and(sql`lower(${destinations.country}) = lower(${data.country})`, sql`lower(${destinations.city}) = lower(${data.city})`)).limit(1);
  if (dup) throw conflict("This destination already exists", [{ path: "city", message: "Already added" }]);
  const [row] = await db.insert(destinations).values(data).returning();
  await logAudit({ action: "catalogue.destination_created", entityType: "destination", entityId: row!.id, newValues: row });
  ok(res, row, "Destination added", 201);
};

export const updateDestination = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(destinationSchema, req.body);
  const [before] = await db.select().from(destinations).where(eq(destinations.id, id));
  if (!before) throw notFound("Destination not found");
  const [row] = await db.update(destinations).set(data).where(eq(destinations.id, id)).returning();
  await logAudit({ action: "catalogue.destination_updated", entityType: "destination", entityId: id, oldValues: before, newValues: row });
  ok(res, row, "Destination saved");
};

export const deleteDestination = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [[h], [p]] = await Promise.all([
    db.select({ n: count() }).from(hotels).where(eq(hotels.destinationId, id)),
    db.select({ n: count() }).from(packages).where(eq(packages.destinationId, id)),
  ]);
  if ((h?.n ?? 0) > 0 || (p?.n ?? 0) > 0) throw badRequest("This destination is used by hotels or packages. Make it inactive instead.");
  const [row] = await db.delete(destinations).where(eq(destinations.id, id)).returning();
  if (!row) throw notFound("Destination not found");
  await logAudit({ action: "catalogue.destination_deleted", entityType: "destination", entityId: id, oldValues: row });
  ok(res, null, "Destination deleted");
};

// ================================================================================
// Hotels
// ================================================================================
const hotelSchema = z.object({
  name: z.string().trim().min(2, "Hotel name is required").max(150),
  destinationId: uuidSchema,
  starRating: optionalInt(1, 7),
  distanceToHaramM: optionalInt(0, 100000),
  area: optionalText(120),
  road: optionalText(120),
  locationAliases: optionalText(400),
  distanceReference: optionalText(150),
  distanceVerifiedOn: z.string().date().nullable().optional(),
  shuttleAvailable: z.boolean().nullable().optional(),
  address: optionalText(300),
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});

export const listHotels = async (req: Request, res: Response) => {
  const destinationId = req.query.destinationId ? parse(uuidSchema, req.query.destinationId) : null;
  const rows = await db
    .select({ hotel: hotels, city: destinations.city, country: destinations.country })
    .from(hotels)
    .innerJoin(destinations, eq(destinations.id, hotels.destinationId))
    .where(destinationId ? eq(hotels.destinationId, destinationId) : undefined)
    .orderBy(asc(destinations.city), asc(hotels.name));
  ok(res, rows.map((r) => ({ ...r.hotel, city: r.city, country: r.country })));
};

export const createHotel = async (req: Request, res: Response) => {
  const data = parse(hotelSchema, req.body);
  const [row] = await db.insert(hotels).values(data).returning();
  await logAudit({ action: "catalogue.hotel_created", entityType: "hotel", entityId: row!.id, newValues: row });
  ok(res, row, "Hotel added", 201);
};

export const updateHotel = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(hotelSchema, req.body);
  const [before] = await db.select().from(hotels).where(eq(hotels.id, id));
  if (!before) throw notFound("Hotel not found");
  const [row] = await db.update(hotels).set(data).where(eq(hotels.id, id)).returning();
  await logAudit({ action: "catalogue.hotel_updated", entityType: "hotel", entityId: id, oldValues: before, newValues: row });
  ok(res, row, "Hotel saved");
};

export const deleteHotel = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [used] = await db.select({ n: count() }).from(packageHotels).where(eq(packageHotels.hotelId, id));
  if ((used?.n ?? 0) > 0) throw badRequest("This hotel is used in packages. Make it inactive instead.");
  const [row] = await db.delete(hotels).where(eq(hotels.id, id)).returning();
  if (!row) throw notFound("Hotel not found");
  await logAudit({ action: "catalogue.hotel_deleted", entityType: "hotel", entityId: id, oldValues: row });
  ok(res, null, "Hotel deleted");
};

// ================================================================================
// Cancellation policies
// ================================================================================
const policySchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  description: optionalText(1000),
  isActive: z.boolean().default(true),
  slabs: z
    .array(
      z.object({
        daysBefore: z.coerce.number().int().min(0).max(730),
        chargeType: z.enum(["percent", "fixed"]),
        chargeValue: z.coerce.number().min(0).max(100_000_000),
      }),
    )
    .max(20)
    .refine((s) => new Set(s.map((x) => x.daysBefore)).size === s.length, "Each slab needs a different number of days")
    .refine((s) => s.every((x) => x.chargeType !== "percent" || x.chargeValue <= 100), "A percentage cannot be more than 100"),
});

export async function policiesWithSlabs(ids?: string[]) {
  const rows = await db.select().from(cancellationPolicies).orderBy(asc(cancellationPolicies.name));
  const filtered = ids ? rows.filter((r) => ids.includes(r.id)) : rows;
  const slabs = await db.select().from(cancellationSlabs).orderBy(asc(cancellationSlabs.daysBefore));
  return filtered.map((p) => ({ ...p, slabs: slabs.filter((s) => s.policyId === p.id).map(({ policyId: _p, ...s }) => s) }));
}

export const listPolicies = async (_req: Request, res: Response) => {
  ok(res, await policiesWithSlabs());
};

async function savePolicy(id: string | null, data: z.infer<typeof policySchema>) {
  return db.transaction(async (tx) => {
    const { slabs, ...policy } = data;
    const [row] = id
      ? await tx.update(cancellationPolicies).set(policy).where(eq(cancellationPolicies.id, id)).returning()
      : await tx.insert(cancellationPolicies).values(policy).returning();
    if (!row) throw notFound("Policy not found");
    await tx.delete(cancellationSlabs).where(eq(cancellationSlabs.policyId, row.id));
    if (slabs.length) await tx.insert(cancellationSlabs).values(slabs.map((s) => ({ ...s, policyId: row.id })));
    await logAudit({ action: id ? "catalogue.policy_updated" : "catalogue.policy_created", entityType: "cancellation_policy", entityId: row.id, newValues: data }, tx);
    return row;
  });
}

export const createPolicy = async (req: Request, res: Response) => {
  const row = await savePolicy(null, parse(policySchema, req.body));
  ok(res, (await policiesWithSlabs([row.id]))[0], "Policy added", 201);
};

export const updatePolicy = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  await savePolicy(id, parse(policySchema, req.body));
  ok(res, (await policiesWithSlabs([id]))[0], "Policy saved");
};

export const deletePolicy = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [used] = await db.select({ n: count() }).from(packages).where(eq(packages.cancellationPolicyId, id));
  if ((used?.n ?? 0) > 0) throw badRequest("This policy is used by packages. Make it inactive instead.");
  const [row] = await db.delete(cancellationPolicies).where(eq(cancellationPolicies.id, id)).returning();
  if (!row) throw notFound("Policy not found");
  await logAudit({ action: "catalogue.policy_deleted", entityType: "cancellation_policy", entityId: id, oldValues: row });
  ok(res, null, "Policy deleted");
};

// ================================================================================
// Document checklist (per product type, optionally per package)
// ================================================================================
const docSchema = z.object({
  vertical,
  packageId: uuidSchema.nullable().optional().transform((v) => v ?? null),
  name: z.string().trim().min(2, "Name is required").max(150),
  description: optionalText(1000),
  isRequired: z.boolean().default(true),
  appliesTo: z.enum(["all", "adult", "child_with_bed", "child_no_bed", "infant"]).default("all"),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const listDocumentRequirements = async (req: Request, res: Response) => {
  const v = req.query.vertical ? parse(vertical, req.query.vertical) : null;
  const packageId = req.query.packageId ? parse(uuidSchema, req.query.packageId) : null;
  const rows = await db
    .select()
    .from(documentRequirements)
    .where(
      and(
        v ? eq(documentRequirements.vertical, v) : undefined,
        packageId ? or(isNull(documentRequirements.packageId), eq(documentRequirements.packageId, packageId)) : isNull(documentRequirements.packageId),
      ),
    )
    .orderBy(asc(documentRequirements.vertical), asc(documentRequirements.sortOrder), asc(documentRequirements.name));
  ok(res, rows);
};

export const createDocumentRequirement = async (req: Request, res: Response) => {
  const data = parse(docSchema, req.body);
  const [row] = await db.insert(documentRequirements).values(data).returning();
  await logAudit({ action: "catalogue.document_requirement_created", entityType: "document_requirement", entityId: row!.id, newValues: row });
  ok(res, row, "Document added to the checklist", 201);
};

export const updateDocumentRequirement = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(docSchema, req.body);
  const [row] = await db.update(documentRequirements).set(data).where(eq(documentRequirements.id, id)).returning();
  if (!row) throw notFound("Checklist item not found");
  await logAudit({ action: "catalogue.document_requirement_updated", entityType: "document_requirement", entityId: id, newValues: row });
  ok(res, row, "Checklist item saved");
};

export const deleteDocumentRequirement = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [row] = await db.delete(documentRequirements).where(eq(documentRequirements.id, id)).returning();
  if (!row) throw notFound("Checklist item not found");
  await logAudit({ action: "catalogue.document_requirement_deleted", entityType: "document_requirement", entityId: id, oldValues: row });
  ok(res, null, "Checklist item deleted");
};
