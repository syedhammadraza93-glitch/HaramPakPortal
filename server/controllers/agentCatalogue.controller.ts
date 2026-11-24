import { and, asc, eq, gte, ilike, inArray, isNull, lte, or } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import {
  destinations, documentRequirements, hotels, packageAddons, packageDepartures, packageHotels, packageImages, packageItinerary,
  packageRates, packages, verticalEnum, visaRates, type Vertical,
} from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { pricerForAgency } from "../services/pricing.service";
import { todayInCompanyTz } from "../services/settings.service";
import { forbidden, notFound, ok, parse } from "../utils/http";
import { paginationSchema, uuidSchema } from "../utils/validation";
import { policiesWithSlabs } from "./catalogueSetup.controller";
import { packageImageUrl, sendBrochure } from "./package.controller";

/** Packages and prices are only for approved (active) agencies. */
export function requireActiveAgency(req: Request, _res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (user.type !== "agent" || !user.agency) return next(forbidden("Agent account required"));
  if (user.agency.status !== "active") return next(forbidden("Packages and prices are available once your agency is approved."));
  next();
}

const agencyIdOf = (req: Request) => currentUser(req).agency!.id;

interface Departure {
  id: string;
  packageId: string;
  departureDate: string;
  returnDate: string | null;
  bookingDeadline: string | null;
  capacity: number | null;
  seatsHeld: number;
  seatsSold: number;
  status: string;
}

interface CatalogueItem {
  id: string;
  code: string;
  vertical: Vertical;
  name: string;
  category: string | null;
  summary: string | null;
  bookingMode: string;
  durationDays: number | null;
  durationNights: number | null;
  seasonYear: number | null;
  destination: string | null;
  currency: string;
  fromPrice: number;
  nextDeparture: { date: string; seatsLeft: number | null; bookingDeadline: string | null } | null;
  departureCount: number;
  coverUrl: string | null;
  flags: { visa: boolean; airTicket: boolean; transport: boolean; ziyarat: boolean };
}

const seatsLeft = (d: Departure) => (d.capacity === null ? null : Math.max(0, d.capacity - d.seatsHeld - d.seatsSold));
/** Bookable: open, in the future, before the deadline and not sold out. */
const isBookable = (d: Departure, today: string) =>
  d.status === "open" && d.departureDate >= today && (!d.bookingDeadline || d.bookingDeadline >= today) && seatsLeft(d) !== 0;

const listQuery = paginationSchema.extend({
  vertical: z.enum(verticalEnum.enumValues).optional(),
  destinationId: uuidSchema.optional(),
  /** YYYY-MM: has a departure in this month */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  minDays: z.coerce.number().int().min(1).max(365).optional(),
  maxDays: z.coerce.number().int().min(1).max(365).optional(),
  category: z.string().trim().max(80).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(["departure", "price", "name"]).default("departure"),
});

/** Published packages visible to agents, with this agency's prices and the next bookable departure. */
async function visiblePackages(agencyId: string, filters: z.infer<typeof listQuery>) {
  const today = await todayInCompanyTz();
  const like = (s: string) => `%${s.replace(/[%_]/g, "")}%`;
  const pkgs = await db
    .select({ pkg: packages, city: destinations.city, country: destinations.country })
    .from(packages)
    .leftJoin(destinations, eq(destinations.id, packages.destinationId))
    .where(
      and(
        eq(packages.status, "published"),
        filters.vertical ? eq(packages.vertical, filters.vertical) : undefined,
        filters.destinationId ? eq(packages.destinationId, filters.destinationId) : undefined,
        filters.minDays ? gte(packages.durationDays, filters.minDays) : undefined,
        filters.maxDays ? lte(packages.durationDays, filters.maxDays) : undefined,
        filters.category ? eq(packages.category, filters.category) : undefined,
        filters.search ? or(ilike(packages.name, like(filters.search)), ilike(packages.code, like(filters.search)), ilike(destinations.city, like(filters.search)), ilike(destinations.country, like(filters.search))) : undefined,
      ),
    );
  if (pkgs.length === 0) return [];
  const ids = pkgs.map((p) => p.pkg.id);
  const [deps, rates, covers] = await Promise.all([
    db.select().from(packageDepartures).where(and(inArray(packageDepartures.packageId, ids), gte(packageDepartures.departureDate, today))).orderBy(asc(packageDepartures.departureDate)),
    db.select().from(packageRates).where(and(inArray(packageRates.packageId, ids), eq(packageRates.isActive, true))),
    db.select({ id: packageImages.id, packageId: packageImages.packageId }).from(packageImages).where(inArray(packageImages.packageId, ids)).orderBy(asc(packageImages.sortOrder), asc(packageImages.createdAt)),
  ]);
  const pricer = await pricerForAgency(agencyId, rates.map((r) => r.id));

  const result: CatalogueItem[] = [];
  for (const { pkg, city, country } of pkgs) {
    const bookable = deps.filter((d) => d.packageId === pkg.id && isBookable(d, today));
    if (pkg.bookingMode === "fixed_departure" && bookable.length === 0) continue;
    if (filters.month && !bookable.some((d) => d.departureDate.startsWith(filters.month!))) continue;
    const bookableIds = new Set(bookable.map((d) => d.id));
    const adultPrices = rates
      .filter((r) => r.packageId === pkg.id && r.paxType === "adult" && (r.departureId === null || bookableIds.has(r.departureId)))
      .map((r) => pricer.price(r));
    if (adultPrices.length === 0) continue;
    const fromPrice = Math.min(...adultPrices);
    if (filters.maxPrice !== undefined && fromPrice > filters.maxPrice) continue;
    const next = bookable[0];
    const cover = covers.find((c) => c.packageId === pkg.id);
    result.push({
      id: pkg.id,
      code: pkg.code,
      vertical: pkg.vertical,
      name: pkg.name,
      category: pkg.category,
      summary: pkg.summary,
      bookingMode: pkg.bookingMode,
      durationDays: pkg.durationDays,
      durationNights: pkg.durationNights,
      seasonYear: pkg.seasonYear,
      destination: city ? `${city}, ${country}` : null,
      currency: pkg.currency,
      fromPrice,
      nextDeparture: next ? { date: next.departureDate, seatsLeft: seatsLeft(next), bookingDeadline: next.bookingDeadline } : null,
      departureCount: bookable.length,
      coverUrl: cover ? packageImageUrl(cover.id) : null,
      flags: { visa: pkg.visaIncluded, airTicket: pkg.airTicketIncluded, transport: pkg.transportIncluded, ziyarat: pkg.ziyaratIncluded },
    });
  }
  const sorters: Record<string, (a: (typeof result)[number], b: (typeof result)[number]) => number> = {
    departure: (a, b) => (a.nextDeparture?.date ?? "9999").localeCompare(b.nextDeparture?.date ?? "9999") || a.name.localeCompare(b.name),
    price: (a, b) => a.fromPrice - b.fromPrice,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return result.sort(sorters[filters.sort]);
}

/** GET /api/agent/catalogue/packages */
export const browsePackages = async (req: Request, res: Response) => {
  const q = parse(listQuery, req.query);
  const all = await visiblePackages(agencyIdOf(req), q);
  ok(res, { items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: all.length, page: q.page, pageSize: q.pageSize });
};

/** GET /api/agent/catalogue/summary: bookable package counts per product type (dashboard). */
export const catalogueSummary = async (req: Request, res: Response) => {
  const all = await visiblePackages(agencyIdOf(req), parse(listQuery, {}));
  const counts: Record<Vertical, number> = { umrah: 0, hajj: 0, tourism: 0 };
  for (const p of all) counts[p.vertical] += 1;
  ok(res, { counts, total: all.length });
};

/** GET /api/agent/catalogue/filters?vertical= : destinations and categories that have packages. */
export const catalogueFilters = async (req: Request, res: Response) => {
  const vertical = req.query.vertical ? parse(z.enum(verticalEnum.enumValues), req.query.vertical) : undefined;
  const all = await visiblePackages(agencyIdOf(req), parse(listQuery, { vertical }));
  const ids = all.map((p) => p.id);
  const dests = ids.length
    ? await db
        .selectDistinct({ id: destinations.id, city: destinations.city, country: destinations.country })
        .from(packages)
        .innerJoin(destinations, eq(destinations.id, packages.destinationId))
        .where(inArray(packages.id, ids))
    : [];
  ok(res, {
    destinations: dests.sort((a, b) => a.city.localeCompare(b.city)),
    categories: [...new Set(all.map((p) => p.category).filter((c): c is string => !!c))].sort(),
  });
};

/** GET /api/agent/catalogue/packages/:id */
export const getAgentPackage = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const agencyId = agencyIdOf(req);
  const today = await todayInCompanyTz();
  const [row] = await db
    .select({ pkg: packages, city: destinations.city, country: destinations.country })
    .from(packages)
    .leftJoin(destinations, eq(destinations.id, packages.destinationId))
    .where(and(eq(packages.id, id), eq(packages.status, "published")))
    .limit(1);
  if (!row) throw notFound("This package is not available");
  const pkg = row.pkg;

  const [hotelRows, itinerary, deps, rates, addons, images, docs] = await Promise.all([
    db
      .select({ link: packageHotels, hotel: hotels, city: destinations.city })
      .from(packageHotels)
      .innerJoin(hotels, eq(hotels.id, packageHotels.hotelId))
      .innerJoin(destinations, eq(destinations.id, hotels.destinationId))
      .where(eq(packageHotels.packageId, id))
      .orderBy(asc(packageHotels.sortOrder)),
    db.select().from(packageItinerary).where(eq(packageItinerary.packageId, id)).orderBy(asc(packageItinerary.dayNumber)),
    db.select().from(packageDepartures).where(and(eq(packageDepartures.packageId, id), gte(packageDepartures.departureDate, today))).orderBy(asc(packageDepartures.departureDate)),
    db.select().from(packageRates).where(and(eq(packageRates.packageId, id), eq(packageRates.isActive, true))),
    db.select().from(packageAddons).where(and(eq(packageAddons.packageId, id), eq(packageAddons.isActive, true))).orderBy(asc(packageAddons.sortOrder)),
    db.select({ id: packageImages.id }).from(packageImages).where(eq(packageImages.packageId, id)).orderBy(asc(packageImages.sortOrder), asc(packageImages.createdAt)),
    db
      .select({ name: documentRequirements.name, description: documentRequirements.description, isRequired: documentRequirements.isRequired, appliesTo: documentRequirements.appliesTo })
      .from(documentRequirements)
      .where(and(eq(documentRequirements.vertical, pkg.vertical), eq(documentRequirements.isActive, true), or(isNull(documentRequirements.packageId), eq(documentRequirements.packageId, id))))
      .orderBy(asc(documentRequirements.sortOrder)),
  ]);
  const visibleDeps = deps.filter((d) => d.status !== "cancelled");
  const depIds = new Set(visibleDeps.map((d) => d.id));
  const visibleRates = rates.filter((r) => r.departureId === null || depIds.has(r.departureId));
  const pricer = await pricerForAgency(agencyId, visibleRates.map((r) => r.id));
  const policy = pkg.cancellationPolicyId ? (await policiesWithSlabs([pkg.cancellationPolicyId]))[0] ?? null : null;

  ok(res, {
    id: pkg.id,
    code: pkg.code,
    vertical: pkg.vertical,
    name: pkg.name,
    category: pkg.category,
    summary: pkg.summary,
    description: pkg.description,
    bookingMode: pkg.bookingMode,
    durationDays: pkg.durationDays,
    durationNights: pkg.durationNights,
    seasonYear: pkg.seasonYear,
    destination: row.city ? `${row.city}, ${row.country}` : null,
    mealPlan: pkg.mealPlan,
    hotelCategory: pkg.hotelCategory,
    minPax: pkg.minPax,
    maxGroupSize: pkg.maxGroupSize,
    flags: { visa: pkg.visaIncluded, airTicket: pkg.airTicketIncluded, transport: pkg.transportIncluded, ziyarat: pkg.ziyaratIncluded },
    inclusions: pkg.inclusions,
    exclusions: pkg.exclusions,
    customFields: pkg.customFields,
    currency: pkg.currency,
    hasBrochure: !!pkg.brochureKey,
    images: images.map((i) => packageImageUrl(i.id)),
    hotels: hotelRows.map((h) => ({ name: h.hotel.name, city: h.city, starRating: h.hotel.starRating, distanceToHaramM: h.hotel.distanceToHaramM, nights: h.link.nights, notes: h.link.notes })),
    itinerary: itinerary.map(({ packageId: _p, id: _i, ...d }) => d),
    departures: visibleDeps.map((d) => ({
      id: d.id,
      departureDate: d.departureDate,
      returnDate: d.returnDate,
      bookingDeadline: d.bookingDeadline,
      seatsLeft: seatsLeft(d),
      bookable: isBookable(d, today),
      status: d.status,
    })),
    // Agent prices only: never the base price, group or other agencies' prices.
    prices: visibleRates.map((r) => ({ id: r.id, departureId: r.departureId, roomType: r.roomType, paxType: r.paxType, price: pricer.price(r), retailPrice: r.retailPrice === null ? null : Number(r.retailPrice) })),
    addons: addons.map((a) => ({ id: a.id, name: a.name, description: a.description, price: Number(a.price), basis: a.basis })),
    documentRequirements: docs,
    cancellationPolicy: policy ? { name: policy.name, description: policy.description, slabs: policy.slabs } : null,
  });
};

/** GET /api/agent/catalogue/packages/:id/brochure */
export const getAgentBrochure = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [pkg] = await db.select().from(packages).where(and(eq(packages.id, id), eq(packages.status, "published"))).limit(1);
  if (!pkg) throw notFound("This package is not available");
  await sendBrochure(res, pkg);
};

/** GET /api/agent/catalogue/visa-rates: rates valid today. */
export const agentVisaRates = async (_req: Request, res: Response) => {
  const today = await todayInCompanyTz();
  const rows = await db
    .select()
    .from(visaRates)
    .where(and(eq(visaRates.isActive, true), lte(visaRates.effectiveFrom, today), or(isNull(visaRates.effectiveTo), gte(visaRates.effectiveTo, today))))
    .orderBy(asc(visaRates.name), asc(visaRates.category));
  ok(
    res,
    rows.map((r) => ({
      id: r.id, name: r.name, category: r.category, visaFee: Number(r.visaFee), serviceFee: Number(r.serviceFee), otherCharges: Number(r.otherCharges),
      total: Number(r.visaFee) + Number(r.serviceFee) + Number(r.otherCharges), currency: r.currency, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, notes: r.notes,
    })),
  );
};
