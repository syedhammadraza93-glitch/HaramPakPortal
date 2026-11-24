import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "../database/connection";
import {
  agencies, agencyRateOverrides, counters, destinations, documentRequirements, hotels, packageAddons, packageDepartures, packageHotels,
  packageImages, packageItinerary, packageRates, packages, packageStatusEnum, paxTypeEnum, priceHistory, roomTypeEnum, verticalEnum,
  type Package, type Vertical,
} from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { announceNewPackage, announcePriceChange } from "../services/agentAlerts.service";
import { logAudit } from "../services/audit.service";
import type { AuthUser } from "../services/authUser.service";
import { getCompany, todayInCompanyTz } from "../services/settings.service";
import { removeFile, saveFile, streamFile } from "../services/storage.service";
import { inspectUpload, safeFileName } from "../utils/files";
import { badRequest, conflict, notFound, ok, parse } from "../utils/http";
import { paginationSchema, uuidSchema } from "../utils/validation";
import { policiesWithSlabs } from "./catalogueSetup.controller";

const CODE_PREFIX: Record<Vertical, string> = { umrah: "UMR", hajj: "HAJ", tourism: "TOU" };
const MAX_IMAGES = 10;
export const packageImageUrl = (imageId: string) => `/api/public/package-images/${imageId}`;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const optionalInt = (min: number, max: number) =>
  z.union([z.coerce.number().int().min(min).max(max), z.literal(""), z.null()]).optional().transform((v) => (v === "" || v === undefined ? null : v));
const money = z.coerce.number().min(0, "Price cannot be negative").max(100_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const textList = z.array(z.string().trim().min(1).max(200)).max(50).default([]);

// ---------- helpers ----------

async function loadPackage(id: string): Promise<Package> {
  const [pkg] = await db.select().from(packages).where(eq(packages.id, id)).limit(1);
  if (!pkg) throw notFound("Package not found");
  return pkg;
}

function assertEditable(pkg: Package) {
  if (pkg.status === "archived") throw badRequest("Archived packages cannot be changed. Restore it first.");
}

async function touch(tx: Tx, pkg: Package, user: AuthUser) {
  await tx.update(packages).set({ updatedBy: user.id, version: sql`${packages.version} + 1` }).where(eq(packages.id, pkg.id));
}

async function nextCode(tx: Tx, vertical: Vertical): Promise<string> {
  const prefix = CODE_PREFIX[vertical];
  const [c] = await tx
    .insert(counters)
    .values({ name: `package_${prefix}`, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${prefix}-${String(c!.value).padStart(4, "0")}`;
}

/** Everything about one package, for the admin editor. */
export async function packageDetail(id: string) {
  const pkg = await loadPackage(id);
  const [hotelRows, itinerary, departures, rates, addons, images, docs, overrideCount] = await Promise.all([
    db
      .select({ link: packageHotels, hotel: hotels, city: destinations.city, country: destinations.country })
      .from(packageHotels)
      .innerJoin(hotels, eq(hotels.id, packageHotels.hotelId))
      .innerJoin(destinations, eq(destinations.id, hotels.destinationId))
      .where(eq(packageHotels.packageId, id))
      .orderBy(asc(packageHotels.sortOrder)),
    db.select().from(packageItinerary).where(eq(packageItinerary.packageId, id)).orderBy(asc(packageItinerary.dayNumber)),
    db.select().from(packageDepartures).where(eq(packageDepartures.packageId, id)).orderBy(asc(packageDepartures.departureDate)),
    db.select().from(packageRates).where(eq(packageRates.packageId, id)).orderBy(asc(packageRates.departureId), asc(packageRates.roomType), asc(packageRates.paxType)),
    db.select().from(packageAddons).where(eq(packageAddons.packageId, id)).orderBy(asc(packageAddons.sortOrder)),
    db.select().from(packageImages).where(eq(packageImages.packageId, id)).orderBy(asc(packageImages.sortOrder), asc(packageImages.createdAt)),
    db
      .select()
      .from(documentRequirements)
      .where(and(eq(documentRequirements.vertical, pkg.vertical), eq(documentRequirements.isActive, true), or(isNull(documentRequirements.packageId), eq(documentRequirements.packageId, id))))
      .orderBy(asc(documentRequirements.sortOrder)),
    db
      .select({ n: count() })
      .from(agencyRateOverrides)
      .innerJoin(packageRates, eq(packageRates.id, agencyRateOverrides.rateId))
      .where(eq(packageRates.packageId, id)),
  ]);
  const policy = pkg.cancellationPolicyId ? (await policiesWithSlabs([pkg.cancellationPolicyId]))[0] ?? null : null;
  const detail = {
    ...pkg,
    hotels: hotelRows.map((r) => ({ id: r.link.id, hotelId: r.hotel.id, name: r.hotel.name, city: r.city, country: r.country, starRating: r.hotel.starRating, distanceToHaramM: r.hotel.distanceToHaramM, nights: r.link.nights, notes: r.link.notes })),
    itinerary,
    departures,
    rates,
    addons,
    images: images.map((i) => ({ id: i.id, fileName: i.fileName, url: packageImageUrl(i.id), isCover: i === images[0] })),
    documentRequirements: docs,
    cancellationPolicy: policy,
    agencySpecialPrices: overrideCount[0]?.n ?? 0,
    hasBrochure: !!pkg.brochureKey,
  };
  return { ...detail, publishProblems: publishProblems(detail, await todayInCompanyTz()) };
}

/** The parts of a package that decide whether it can be published. */
interface PublishInput {
  durationDays: number | null;
  summary: string | null;
  description: string | null;
  vertical: Vertical;
  seasonYear: number | null;
  destinationId: string | null;
  bookingMode: string;
  hotels: unknown[];
  rates: { isActive: boolean; basePrice: number }[];
  departures: { status: string; departureDate: string }[];
}

/** What is still missing before a package can be published (empty = ready). */
function publishProblems(p: PublishInput, today: string): string[] {
  const problems: string[] = [];
  if (!p.durationDays) problems.push("Set the duration (days)");
  if (!p.summary && !p.description) problems.push("Add a short summary or description");
  if (p.vertical === "hajj" && !p.seasonYear) problems.push("Set the Hajj season year");
  if (p.vertical !== "tourism" && p.hotels.length === 0) problems.push("Add at least one hotel");
  if (p.vertical === "tourism" && !p.destinationId) problems.push("Choose the destination");
  if (!p.rates.some((r) => r.isActive && Number(r.basePrice) > 0)) problems.push("Add at least one price");
  if (p.bookingMode === "fixed_departure" && !p.departures.some((d) => d.status === "open" && d.departureDate >= today)) {
    problems.push("Add at least one open departure date in the future");
  }
  return problems;
}

async function recordPrice(tx: Tx, user: AuthUser, entry: { packageId: string; rateId?: string | null; agencyId?: string | null; description: string; oldValue: number | null; newValue: number | null }) {
  await tx.insert(priceHistory).values({ ...entry, changedBy: user.id, changedByName: user.fullName });
}

const ROOM_LABEL: Record<string, string> = { sharing: "Sharing", quad: "Quad", triple: "Triple", double: "Double", single: "Single" };
const PAX_LABEL: Record<string, string> = { adult: "Adult", child_with_bed: "Child with bed", child_no_bed: "Child without bed", infant: "Infant" };
const rateLabel = (r: { roomType: string; paxType: string }, departureDate?: string | null) =>
  `${ROOM_LABEL[r.roomType]} · ${PAX_LABEL[r.paxType]}${departureDate ? ` (${departureDate})` : ""}`;

// ================================================================================
// List, create, overview
// ================================================================================
const listQuery = paginationSchema.extend({
  vertical: z.enum(verticalEnum.enumValues).optional(),
  status: z.enum(packageStatusEnum.enumValues).optional(),
  search: z.string().trim().max(100).optional(),
});

/** GET /api/admin/packages */
export const listPackages = async (req: Request, res: Response) => {
  const q = parse(listQuery, req.query);
  const where = and(
    q.vertical ? eq(packages.vertical, q.vertical) : undefined,
    q.status ? eq(packages.status, q.status) : notInArray(packages.status, ["archived"]),
    q.search ? or(ilike(packages.name, `%${q.search.replace(/[%_]/g, "")}%`), ilike(packages.code, `%${q.search.replace(/[%_]/g, "")}%`), ilike(packages.category, `%${q.search.replace(/[%_]/g, "")}%`)) : undefined,
  );
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(packages).where(where),
    db
      .select({
        id: packages.id, code: packages.code, vertical: packages.vertical, name: packages.name, category: packages.category, status: packages.status,
        bookingMode: packages.bookingMode, durationDays: packages.durationDays, seasonYear: packages.seasonYear, updatedAt: packages.updatedAt,
        destination: sql<string | null>`(select d.city || ', ' || d.country from destinations d where d.id = "packages"."destination_id")`,
        nextDeparture: sql<string | null>`(select min(pd.departure_date)::text from package_departures pd where pd.package_id = "packages"."id" and pd.status = 'open' and pd.departure_date >= current_date)`,
        fromPrice: sql<number | null>`(select min(pr.base_price)::float from package_rates pr where pr.package_id = "packages"."id" and pr.is_active and pr.pax_type = 'adult')`,
        coverImageId: sql<string | null>`(select pi.id from package_images pi where pi.package_id = "packages"."id" order by pi.sort_order, pi.created_at limit 1)`,
      })
      .from(packages)
      .where(where)
      .orderBy(desc(packages.updatedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items: items.map((i) => ({ ...i, coverUrl: i.coverImageId ? packageImageUrl(i.coverImageId) : null })), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

const createSchema = z.object({
  vertical: z.enum(verticalEnum.enumValues),
  name: z.string().trim().min(3, "Package name is required").max(200),
  category: optionalText(80),
  bookingMode: z.enum(["fixed_departure", "on_request"]).default("fixed_departure"),
});

/** POST /api/admin/packages: creates a draft. */
export const createPackage = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const data = parse(createSchema, req.body);
  const { currency } = await getCompany();
  const row = await db.transaction(async (tx) => {
    const code = await nextCode(tx, data.vertical);
    const [pkg] = await tx.insert(packages).values({ ...data, code, currency, createdBy: user.id, updatedBy: user.id }).returning();
    await logAudit({ action: "package.created", entityType: "package", entityId: pkg!.id, newValues: pkg }, tx);
    return pkg!;
  });
  ok(res, row, `Draft package ${row.code} created`, 201);
};

/** GET /api/admin/packages/:id */
export const getPackage = async (req: Request, res: Response) => {
  ok(res, await packageDetail(parse(uuidSchema, req.params.id)));
};

const overviewSchema = z.object({
  name: z.string().trim().min(3, "Package name is required").max(200),
  category: optionalText(80),
  bookingMode: z.enum(["fixed_departure", "on_request"]),
  summary: optionalText(300),
  description: optionalText(10000),
  durationDays: optionalInt(1, 365),
  durationNights: optionalInt(0, 365),
  destinationId: uuidSchema.nullable().optional().transform((v) => v ?? null),
  seasonYear: optionalInt(2000, 2100),
  visaIncluded: z.boolean().default(false),
  airTicketIncluded: z.boolean().default(false),
  transportIncluded: z.boolean().default(false),
  ziyaratIncluded: z.boolean().default(false),
  mealPlan: optionalText(80),
  hotelCategory: optionalText(50),
  minPax: z.coerce.number().int().min(1).max(500).default(1),
  maxGroupSize: optionalInt(1, 5000),
  inclusions: textList,
  exclusions: textList,
  customFields: z.record(z.string().trim().min(1).max(60), z.string().trim().max(500)).default({}),
  cancellationPolicyId: uuidSchema.nullable().optional().transform((v) => v ?? null),
});

/** PATCH /api/admin/packages/:id */
export const updatePackage = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const data = parse(overviewSchema, req.body);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  if (data.durationDays && data.durationNights !== null && data.durationNights > data.durationDays) {
    throw badRequest("Nights cannot be more than days", [{ path: "durationNights", message: "Nights cannot be more than days" }]);
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.update(packages).set({ ...data, updatedBy: user.id, version: sql`${packages.version} + 1` }).where(eq(packages.id, id)).returning();
    await logAudit({ action: "package.updated", entityType: "package", entityId: id, oldValues: pkg, newValues: row }, tx);
  });
  ok(res, await packageDetail(id), "Package saved");
};

// ================================================================================
// Hotels, itinerary, add-ons (replace the whole list)
// ================================================================================
const hotelsSchema = z.object({
  hotels: z.array(z.object({ hotelId: uuidSchema, nights: z.coerce.number().int().min(0).max(365), notes: optionalText(200) })).max(20),
});

export const saveHotels = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const { hotels: list } = parse(hotelsSchema, req.body);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  await db.transaction(async (tx) => {
    await tx.delete(packageHotels).where(eq(packageHotels.packageId, id));
    if (list.length) await tx.insert(packageHotels).values(list.map((h, i) => ({ ...h, packageId: id, sortOrder: i })));
    await touch(tx, pkg, user);
    await logAudit({ action: "package.hotels_updated", entityType: "package", entityId: id, newValues: list }, tx);
  });
  ok(res, await packageDetail(id), "Hotels saved");
};

const itinerarySchema = z.object({
  days: z
    .array(z.object({ dayNumber: z.coerce.number().int().min(1).max(365), title: z.string().trim().min(2, "Title is required").max(150), description: optionalText(5000), city: optionalText(80) }))
    .max(120)
    .refine((d) => new Set(d.map((x) => x.dayNumber)).size === d.length, "Each day number can be used once"),
});

export const saveItinerary = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const { days } = parse(itinerarySchema, req.body);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  await db.transaction(async (tx) => {
    await tx.delete(packageItinerary).where(eq(packageItinerary.packageId, id));
    if (days.length) await tx.insert(packageItinerary).values(days.map((d) => ({ ...d, packageId: id })));
    await touch(tx, pkg, user);
    await logAudit({ action: "package.itinerary_updated", entityType: "package", entityId: id, newValues: days }, tx);
  });
  ok(res, await packageDetail(id), "Itinerary saved");
};

const addonsSchema = z.object({
  addons: z
    .array(
      z.object({
        id: uuidSchema.optional(),
        name: z.string().trim().min(2, "Name is required").max(120),
        description: optionalText(1000),
        price: money,
        basis: z.enum(["per_person", "per_booking"]).default("per_person"),
        isActive: z.boolean().default(true),
      }),
    )
    .max(30),
});

/** Add-ons keep their ids (bookings will refer to them), so this updates, inserts and deletes. */
export const saveAddons = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const { addons } = parse(addonsSchema, req.body);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(packageAddons).where(eq(packageAddons.packageId, id));
    const keep = addons.filter((a) => a.id && existing.some((e) => e.id === a.id)).map((a) => a.id!);
    const remove = existing.filter((e) => !keep.includes(e.id)).map((e) => e.id);
    if (remove.length) await tx.delete(packageAddons).where(inArray(packageAddons.id, remove));
    for (const [i, a] of addons.entries()) {
      const before = existing.find((e) => e.id === a.id);
      const values = { name: a.name, description: a.description, price: a.price, basis: a.basis, isActive: a.isActive, sortOrder: i };
      if (before) {
        await tx.update(packageAddons).set(values).where(eq(packageAddons.id, before.id));
        if (Number(before.price) !== a.price) await recordPrice(tx, user, { packageId: id, description: `Add-on: ${a.name}`, oldValue: Number(before.price), newValue: a.price });
      } else {
        await tx.insert(packageAddons).values({ ...values, packageId: id });
        await recordPrice(tx, user, { packageId: id, description: `Add-on: ${a.name}`, oldValue: null, newValue: a.price });
      }
    }
    await touch(tx, pkg, user);
    await logAudit({ action: "package.addons_updated", entityType: "package", entityId: id, newValues: addons }, tx);
  });
  ok(res, await packageDetail(id), "Add-ons saved");
};

// ================================================================================
// Departures
// ================================================================================
const departureSchema = z
  .object({
    departureDate: isoDate,
    returnDate: isoDate.nullable().optional().transform((v) => v ?? null),
    bookingDeadline: isoDate.nullable().optional().transform((v) => v ?? null),
    capacity: optionalInt(1, 100000),
    status: z.enum(["open", "closed", "cancelled"]).default("open"),
    notes: optionalText(200),
  })
  .refine((d) => !d.returnDate || d.returnDate >= d.departureDate, { path: ["returnDate"], message: "Return date must be on or after the departure date" })
  .refine((d) => !d.bookingDeadline || d.bookingDeadline <= d.departureDate, { path: ["bookingDeadline"], message: "Booking deadline must be on or before the departure date" });

export const createDeparture = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const data = parse(departureSchema, req.body);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(packageDepartures).values({ ...data, packageId: id }).returning();
    await touch(tx, pkg, user);
    await logAudit({ action: "package.departure_added", entityType: "package", entityId: id, newValues: row }, tx);
  });
  ok(res, await packageDetail(id), "Departure added", 201);
};

export const updateDeparture = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const depId = parse(uuidSchema, req.params.departureId);
  const data = parse(departureSchema, req.body);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  const [before] = await db.select().from(packageDepartures).where(and(eq(packageDepartures.id, depId), eq(packageDepartures.packageId, id)));
  if (!before) throw notFound("Departure not found");
  if (data.capacity !== null && data.capacity < before.seatsHeld + before.seatsSold) {
    throw badRequest(`Capacity cannot be lower than the ${before.seatsHeld + before.seatsSold} seats already held or sold`, [{ path: "capacity", message: "Lower than seats already taken" }]);
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.update(packageDepartures).set(data).where(eq(packageDepartures.id, depId)).returning();
    await touch(tx, pkg, user);
    await logAudit({ action: "package.departure_updated", entityType: "package", entityId: id, oldValues: before, newValues: row }, tx);
  });
  ok(res, await packageDetail(id), "Departure saved");
};

export const deleteDeparture = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const depId = parse(uuidSchema, req.params.departureId);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  const [dep] = await db.select().from(packageDepartures).where(and(eq(packageDepartures.id, depId), eq(packageDepartures.packageId, id)));
  if (!dep) throw notFound("Departure not found");
  if (dep.seatsHeld + dep.seatsSold > 0) throw badRequest("This departure has bookings. Set its status to Cancelled or Closed instead.");
  await db.transaction(async (tx) => {
    await tx.delete(packageDepartures).where(eq(packageDepartures.id, depId));
    await touch(tx, pkg, user);
    await logAudit({ action: "package.departure_deleted", entityType: "package", entityId: id, oldValues: dep }, tx);
  });
  ok(res, await packageDetail(id), "Departure deleted");
};

// ================================================================================
// Prices
// ================================================================================
const ratesSchema = z.object({
  rates: z
    .array(
      z.object({
        id: uuidSchema.optional(),
        departureId: uuidSchema.nullable().optional().transform((v) => v ?? null),
        roomType: z.enum(roomTypeEnum.enumValues),
        paxType: z.enum(paxTypeEnum.enumValues),
        basePrice: money,
        retailPrice: z.union([money, z.literal(""), z.null()]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
        isActive: z.boolean().default(true),
      }),
    )
    .max(200)
    .refine((r) => new Set(r.map((x) => `${x.departureId}|${x.roomType}|${x.paxType}`)).size === r.length, "Each room type and passenger type can have one price per departure"),
});

/** PUT /api/admin/packages/:id/rates: the full price grid. Every change is written to price history. */
export const saveRates = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const { rates } = parse(ratesSchema, req.body);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  const deps = await db.select({ id: packageDepartures.id, date: packageDepartures.departureDate }).from(packageDepartures).where(eq(packageDepartures.packageId, id));
  const depDate = new Map(deps.map((d) => [d.id, d.date]));
  if (rates.some((r) => r.departureId && !depDate.has(r.departureId))) throw badRequest("A price refers to a departure of another package");

  let pricesChanged = false;
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(packageRates).where(eq(packageRates.packageId, id));
    const keyOf = (r: { departureId: string | null; roomType: string; paxType: string }) => `${r.departureId}|${r.roomType}|${r.paxType}`;
    const byKey = new Map(existing.map((e) => [keyOf(e), e]));
    const kept = new Set<string>();

    for (const r of rates) {
      const before = (r.id && existing.find((e) => e.id === r.id)) || byKey.get(keyOf(r));
      const label = rateLabel(r, r.departureId ? depDate.get(r.departureId) : null);
      const values = { departureId: r.departureId, roomType: r.roomType, paxType: r.paxType, basePrice: r.basePrice, retailPrice: r.retailPrice, isActive: r.isActive };
      if (before) {
        kept.add(before.id);
        await tx.update(packageRates).set(values).where(eq(packageRates.id, before.id));
        if (Number(before.basePrice) !== r.basePrice) pricesChanged = true;
        if (Number(before.basePrice) !== r.basePrice) await recordPrice(tx, user, { packageId: id, rateId: before.id, description: label, oldValue: Number(before.basePrice), newValue: r.basePrice });
        if ((before.retailPrice === null ? null : Number(before.retailPrice)) !== r.retailPrice) {
          await recordPrice(tx, user, { packageId: id, rateId: before.id, description: `${label} · reference price`, oldValue: before.retailPrice === null ? null : Number(before.retailPrice), newValue: r.retailPrice });
        }
      } else {
        const [row] = await tx.insert(packageRates).values({ ...values, packageId: id }).returning({ id: packageRates.id });
        kept.add(row!.id);
        await recordPrice(tx, user, { packageId: id, rateId: row!.id, description: label, oldValue: null, newValue: r.basePrice });
      }
    }
    const removed = existing.filter((e) => !kept.has(e.id));
    for (const e of removed) await recordPrice(tx, user, { packageId: id, rateId: e.id, description: `${rateLabel(e, e.departureId ? depDate.get(e.departureId) : null)} · removed`, oldValue: Number(e.basePrice), newValue: null });
    if (removed.length) await tx.delete(packageRates).where(inArray(packageRates.id, removed.map((e) => e.id)));
    if (removed.length || rates.length > existing.length) pricesChanged = true;
    await touch(tx, pkg, user);
    await logAudit({ action: "package.prices_updated", entityType: "package", entityId: id, newValues: rates }, tx);
  });
  // Agents hear about price changes on packages they can see.
  if (pricesChanged && pkg.status === "published") announcePriceChange({ id, name: pkg.name });
  ok(res, await packageDetail(id), "Prices saved");
};

/** GET /api/admin/packages/:id/price-history */
export const getPriceHistory = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const rows = await db
    .select({ entry: priceHistory, agencyName: agencies.agencyName, agentCode: agencies.agentCode })
    .from(priceHistory)
    .leftJoin(agencies, eq(agencies.id, priceHistory.agencyId))
    .where(eq(priceHistory.packageId, id))
    .orderBy(desc(priceHistory.createdAt))
    .limit(300);
  ok(res, rows.map((r) => ({ ...r.entry, agencyName: r.agencyName, agentCode: r.agentCode })));
};

/** GET /api/admin/packages/:id/special-prices: agency-specific prices on this package. */
export const listSpecialPrices = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const rows = await db
    .select({ override: agencyRateOverrides, agencyName: agencies.agencyName, agentCode: agencies.agentCode })
    .from(agencyRateOverrides)
    .innerJoin(packageRates, eq(packageRates.id, agencyRateOverrides.rateId))
    .innerJoin(agencies, eq(agencies.id, agencyRateOverrides.agencyId))
    .where(eq(packageRates.packageId, id))
    .orderBy(asc(agencies.agencyName));
  ok(res, rows.map((r) => ({ ...r.override, agencyName: r.agencyName, agentCode: r.agentCode })));
};

const specialSchema = z.object({
  prices: z.array(z.object({ rateId: uuidSchema, price: z.union([money, z.null()]), note: optionalText(200) })).max(200),
});

/** PUT /api/admin/packages/:id/special-prices/:agencyId  { prices: [{ rateId, price | null }] } (null removes) */
export const saveSpecialPrices = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const agencyId = parse(uuidSchema, req.params.agencyId);
  const { prices } = parse(specialSchema, req.body);
  const [agency] = await db.select({ id: agencies.id, status: agencies.status }).from(agencies).where(eq(agencies.id, agencyId));
  if (!agency) throw notFound("Agency not found");
  const rates = await db.select().from(packageRates).where(eq(packageRates.packageId, id));
  if (prices.some((p) => !rates.some((r) => r.id === p.rateId))) throw badRequest("A price refers to another package");

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(agencyRateOverrides).where(and(eq(agencyRateOverrides.agencyId, agencyId), inArray(agencyRateOverrides.rateId, rates.map((r) => r.id))));
    for (const p of prices) {
      const rate = rates.find((r) => r.id === p.rateId)!;
      const before = existing.find((e) => e.rateId === p.rateId);
      const label = `Special price · ${rateLabel(rate)}`;
      if (p.price === null) {
        if (before) {
          await tx.delete(agencyRateOverrides).where(eq(agencyRateOverrides.id, before.id));
          await recordPrice(tx, user, { packageId: id, rateId: rate.id, agencyId, description: `${label} · removed`, oldValue: Number(before.price), newValue: null });
        }
      } else if (before) {
        if (Number(before.price) !== p.price || before.note !== p.note) {
          await tx.update(agencyRateOverrides).set({ price: p.price, note: p.note }).where(eq(agencyRateOverrides.id, before.id));
          await recordPrice(tx, user, { packageId: id, rateId: rate.id, agencyId, description: label, oldValue: Number(before.price), newValue: p.price });
        }
      } else {
        await tx.insert(agencyRateOverrides).values({ agencyId, rateId: rate.id, price: p.price, note: p.note, createdBy: user.id });
        await recordPrice(tx, user, { packageId: id, rateId: rate.id, agencyId, description: label, oldValue: null, newValue: p.price });
      }
    }
    await logAudit({ action: "package.special_prices_updated", entityType: "package", entityId: id, newValues: { agencyId, prices } }, tx);
  });
  ok(res, null, "Special prices saved");
};

// ================================================================================
// Images and brochure
// ================================================================================

/** POST /api/admin/packages/:id/images (multipart "files", up to 10 images) */
export const uploadImages = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest("Choose at least one image");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(packageImages).where(eq(packageImages.packageId, id));
  if (n + files.length > MAX_IMAGES) throw badRequest(`A package can have up to ${MAX_IMAGES} images`);
  const checked = files.map((f) => ({ file: f, info: inspectUpload(f) }));
  if (checked.some((c) => c.info.mime === "application/pdf")) throw badRequest("Only JPG, PNG or WebP images are allowed here");

  const saved: { key: string }[] = [];
  try {
    await db.transaction(async (tx) => {
      for (const [i, c] of checked.entries()) {
        const imageId = randomUUID();
        const key = `packages/${id}/images/${imageId}.${c.info.ext}`;
        await saveFile(key, c.file.buffer);
        saved.push({ key });
        await tx.insert(packageImages).values({ id: imageId, packageId: id, storageKey: key, fileName: safeFileName(c.file.originalname), mimeType: c.info.mime, sizeBytes: c.file.size, sortOrder: n + i });
      }
      await touch(tx, pkg, user);
      await logAudit({ action: "package.images_added", entityType: "package", entityId: id, newValues: checked.map((c) => c.file.originalname) }, tx);
    });
  } catch (e) {
    await Promise.all(saved.map((s) => removeFile(s.key).catch(() => undefined)));
    throw e;
  }
  ok(res, await packageDetail(id), "Images uploaded", 201);
};

export const deleteImage = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const imageId = parse(uuidSchema, req.params.imageId);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  const [img] = await db.delete(packageImages).where(and(eq(packageImages.id, imageId), eq(packageImages.packageId, id))).returning();
  if (!img) throw notFound("Image not found");
  await removeFile(img.storageKey).catch(() => undefined);
  await db.transaction(async (tx) => {
    await touch(tx, pkg, user);
    await logAudit({ action: "package.image_deleted", entityType: "package", entityId: id, oldValues: { fileName: img.fileName } }, tx);
  });
  ok(res, await packageDetail(id), "Image deleted");
};

/** POST /api/admin/packages/:id/images/:imageId/cover */
export const setCoverImage = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const imageId = parse(uuidSchema, req.params.imageId);
  const images = await db.select().from(packageImages).where(eq(packageImages.packageId, id)).orderBy(asc(packageImages.sortOrder), asc(packageImages.createdAt));
  if (!images.some((i) => i.id === imageId)) throw notFound("Image not found");
  const ordered = [imageId, ...images.filter((i) => i.id !== imageId).map((i) => i.id)];
  await db.transaction(async (tx) => {
    for (const [i, imgId] of ordered.entries()) await tx.update(packageImages).set({ sortOrder: i }).where(eq(packageImages.id, imgId));
  });
  ok(res, await packageDetail(id), "Cover image set");
};

/** GET /api/public/package-images/:imageId (marketing images; ids are not guessable) */
export const servePackageImage = async (req: Request, res: Response) => {
  const imageId = parse(uuidSchema, req.params.imageId);
  const [img] = await db.select().from(packageImages).where(eq(packageImages.id, imageId)).limit(1);
  if (!img) throw notFound("Image not found");
  res.setHeader("Content-Type", img.mimeType);
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  const stream = streamFile(img.storageKey);
  stream.on("error", () => (res.headersSent ? res.end() : res.status(404).json({ success: false, message: "Image file is missing" })));
  stream.pipe(res);
};

export const uploadBrochure = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  if (!req.file) throw badRequest("Choose a PDF file");
  if (inspectUpload(req.file).mime !== "application/pdf") throw badRequest("The brochure must be a PDF");
  const key = `packages/${id}/brochure-${Date.now()}.pdf`;
  await saveFile(key, req.file.buffer);
  await db.transaction(async (tx) => {
    await tx.update(packages).set({ brochureKey: key, brochureName: safeFileName(req.file!.originalname), updatedBy: user.id, version: sql`${packages.version} + 1` }).where(eq(packages.id, id));
    await logAudit({ action: "package.brochure_uploaded", entityType: "package", entityId: id, newValues: { fileName: req.file!.originalname } }, tx);
  });
  if (pkg.brochureKey) await removeFile(pkg.brochureKey).catch(() => undefined);
  ok(res, await packageDetail(id), "Brochure uploaded");
};

export const deleteBrochure = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const pkg = await loadPackage(id);
  assertEditable(pkg);
  if (!pkg.brochureKey) throw notFound("No brochure uploaded");
  await db.update(packages).set({ brochureKey: null, brochureName: null, updatedBy: user.id }).where(eq(packages.id, id));
  await removeFile(pkg.brochureKey).catch(() => undefined);
  await logAudit({ action: "package.brochure_deleted", entityType: "package", entityId: id });
  ok(res, await packageDetail(id), "Brochure removed");
};

/** Streams a package brochure (used by the admin and agent routes, which check access first). */
export async function sendBrochure(res: Response, pkg: Package) {
  if (!pkg.brochureKey) throw notFound("No brochure for this package");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${(pkg.brochureName ?? `${pkg.code}.pdf`).replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  const stream = streamFile(pkg.brochureKey);
  stream.on("error", () => (res.headersSent ? res.end() : res.status(404).json({ success: false, message: "Brochure file is missing" })));
  stream.pipe(res);
}

export const downloadBrochure = async (req: Request, res: Response) => {
  await sendBrochure(res, await loadPackage(parse(uuidSchema, req.params.id)));
};

// ================================================================================
// Status and duplicate
// ================================================================================
const TRANSITIONS: Record<string, { from: Package["status"][]; to: Package["status"] }> = {
  publish: { from: ["draft", "unpublished"], to: "published" },
  unpublish: { from: ["published"], to: "unpublished" },
  archive: { from: ["draft", "published", "unpublished"], to: "archived" },
  restore: { from: ["archived"], to: "draft" },
};

/** POST /api/admin/packages/:id/status/:action  (publish | unpublish | archive | restore) */
export const changePackageStatus = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const action = String(req.params.action);
  const rule = TRANSITIONS[action];
  if (!rule) throw notFound("Unknown action");
  const detail = await packageDetail(id);
  if (!rule.from.includes(detail.status)) throw badRequest(`A ${detail.status} package cannot be ${action === "publish" ? "published" : action + "d"}`);
  if (action === "publish" && detail.publishProblems.length) {
    throw badRequest("The package is not ready to publish", detail.publishProblems.map((m) => ({ path: "publish", message: m })));
  }
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(packages)
      .set({ status: rule.to, ...(action === "publish" ? { publishedAt: new Date() } : {}), updatedBy: user.id, version: sql`${packages.version} + 1` })
      .where(and(eq(packages.id, id), eq(packages.status, detail.status)))
      .returning({ id: packages.id });
    if (rows.length === 0) throw conflict("The package was changed by someone else. Please reload.");
    await logAudit({ action: `package.${action}`, entityType: "package", entityId: id, oldValues: { status: detail.status }, newValues: { status: rule.to } }, tx);
  });
  if (action === "publish" && !detail.publishedAt) announceNewPackage({ id, name: detail.name, vertical: detail.vertical });
  const messages: Record<string, string> = { publish: "Published: agents can now see this package", unpublish: "Unpublished: hidden from agents", archive: "Archived", restore: "Restored as a draft" };
  ok(res, await packageDetail(id), messages[action]);
};

/** POST /api/admin/packages/:id/duplicate: new draft with the same details, hotels, itinerary, add-ons and general prices. */
export const duplicatePackage = async (req: Request, res: Response) => {
  const user = currentUser(req);
  const id = parse(uuidSchema, req.params.id);
  const src = await loadPackage(id);
  const copy = await db.transaction(async (tx) => {
    const code = await nextCode(tx, src.vertical);
    const { id: _id, code: _code, status: _s, publishedAt: _p, brochureKey: _bk, brochureName: _bn, createdAt: _c, updatedAt: _u, version: _v, ...fields } = src;
    const [pkg] = await tx.insert(packages).values({ ...fields, code, name: `${src.name} (copy)`.slice(0, 200), status: "draft", createdBy: user.id, updatedBy: user.id }).returning();
    const newId = pkg!.id;
    const [h, it, ad, rt, docs] = await Promise.all([
      tx.select().from(packageHotels).where(eq(packageHotels.packageId, id)),
      tx.select().from(packageItinerary).where(eq(packageItinerary.packageId, id)),
      tx.select().from(packageAddons).where(eq(packageAddons.packageId, id)),
      tx.select().from(packageRates).where(and(eq(packageRates.packageId, id), isNull(packageRates.departureId))),
      tx.select().from(documentRequirements).where(eq(documentRequirements.packageId, id)),
    ]);
    const strip = <T extends { id: string }>(rows: T[]) => rows.map(({ id: _x, ...r }) => ({ ...r, packageId: newId }));
    if (h.length) await tx.insert(packageHotels).values(strip(h));
    if (it.length) await tx.insert(packageItinerary).values(strip(it));
    if (ad.length) await tx.insert(packageAddons).values(strip(ad));
    if (rt.length) await tx.insert(packageRates).values(rt.map(({ id: _x, createdAt: _c2, updatedAt: _u2, ...r }) => ({ ...r, packageId: newId })));
    if (docs.length) await tx.insert(documentRequirements).values(docs.map(({ id: _x, createdAt: _c3, updatedAt: _u3, ...r }) => ({ ...r, packageId: newId })));
    await logAudit({ action: "package.duplicated", entityType: "package", entityId: newId, newValues: { from: src.code, to: code } }, tx);
    return pkg!;
  });
  ok(res, copy, `Copied to ${copy.code}. Add departures and images, then publish.`, 201);
};

