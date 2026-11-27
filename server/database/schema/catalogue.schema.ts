import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uuid, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import { cancellationPolicies } from "./pricing.schema";

// ================================================================================
// Enums
// ================================================================================
export const verticalEnum = pgEnum("vertical", ["umrah", "hajj", "tourism"]);
export const packageStatusEnum = pgEnum("package_status", ["draft", "published", "unpublished", "archived"]);
/** fixed_departure: agents book a listed date. on_request: agents ask for dates (no live inventory). */
export const bookingModeEnum = pgEnum("booking_mode", ["fixed_departure", "on_request"]);
export const departureStatusEnum = pgEnum("departure_status", ["open", "closed", "cancelled"]);
export const roomTypeEnum = pgEnum("room_type", ["sharing", "quad", "triple", "double", "single"]);
export const paxTypeEnum = pgEnum("pax_type", ["adult", "child_with_bed", "child_no_bed", "infant"]);
export const chargeBasisEnum = pgEnum("charge_basis", ["per_person", "per_booking"]);

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
};

// ================================================================================
// Master data: destinations and hotels
// ================================================================================
export const destinations = pgTable(
  "destinations",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    country: varchar("country", { length: 80 }).notNull(),
    city: varchar("city", { length: 80 }).notNull(),
    /** Which verticals use this destination, e.g. Makkah → umrah + hajj. */
    verticals: jsonb("verticals").$type<("umrah" | "hajj" | "tourism")[]>().default([]).notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    ...timestamps,
  },
  (t) => [unique("destinations_country_city_unique").on(t.country, t.city)],
);

export const hotels = pgTable(
  "hotels",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    destinationId: uuid("destination_id").notNull().references(() => destinations.id, { onDelete: "restrict" }),
    starRating: integer("star_rating"),
    /** Walking distance to the Haram (Makkah/Madinah), in metres. */
    distanceToHaramM: integer("distance_to_haram_m"),
    area: varchar("area", { length: 120 }),
    road: varchar("road", { length: 120 }),
    locationAliases: varchar("location_aliases", { length: 400 }),
    distanceReference: varchar("distance_reference", { length: 150 }),
    distanceVerifiedOn: date("distance_verified_on"),
    shuttleAvailable: boolean("shuttle_available"),
    indicativeNightlySar: money("indicative_nightly_sar"),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (t) => [index("hotels_destination_idx").on(t.destinationId)],
);

// ================================================================================
// Packages
// ================================================================================
export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    /** e.g. UMR-0001, HAJ-0001, TOU-0001 */
    code: varchar("code", { length: 20 }).notNull().unique(),
    vertical: verticalEnum("vertical").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    /** Free text such as "Economy", "Premium 5-star", "Hajj Package B". */
    category: varchar("category", { length: 80 }),
    status: packageStatusEnum("status").default("draft").notNull(),
    bookingMode: bookingModeEnum("booking_mode").default("fixed_departure").notNull(),
    summary: varchar("summary", { length: 300 }),
    description: text("description"),
    durationDays: integer("duration_days"),
    durationNights: integer("duration_nights"),
    /** Main destination (tourism) or Makkah (umrah/hajj). */
    destinationId: uuid("destination_id").references(() => destinations.id, { onDelete: "set null" }),
    /** Hajj season, e.g. 2027. */
    seasonYear: integer("season_year"),
    visaIncluded: boolean("visa_included").default(false).notNull(),
    airTicketIncluded: boolean("air_ticket_included").default(false).notNull(),
    transportIncluded: boolean("transport_included").default(false).notNull(),
    ziyaratIncluded: boolean("ziyarat_included").default(false).notNull(),
    mealPlan: varchar("meal_plan", { length: 80 }),
    hotelCategory: varchar("hotel_category", { length: 50 }),
    minPax: integer("min_pax").default(1).notNull(),
    maxGroupSize: integer("max_group_size"),
    inclusions: jsonb("inclusions").$type<string[]>().default([]).notNull(),
    exclusions: jsonb("exclusions").$type<string[]>().default([]).notNull(),
    /** Extra configurable fields per package type (label → value). */
    customFields: jsonb("custom_fields").$type<Record<string, string>>().default({}).notNull(),
    cancellationPolicyId: uuid("cancellation_policy_id").references((): AnyPgColumn => cancellationPolicies.id, { onDelete: "set null" }),
    currency: varchar("currency", { length: 3 }).default("PKR").notNull(),
    brochureKey: varchar("brochure_key", { length: 300 }),
    brochureName: varchar("brochure_name", { length: 150 }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    ...timestamps,
    version: integer("version").default(0).notNull(),
  },
  (t) => [index("packages_vertical_status_idx").on(t.vertical, t.status)],
);

export const packageHotels = pgTable(
  "package_hotels",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    hotelId: uuid("hotel_id").notNull().references(() => hotels.id, { onDelete: "restrict" }),
    nights: integer("nights").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    notes: varchar("notes", { length: 200 }),
  },
  (t) => [index("package_hotels_package_idx").on(t.packageId)],
);

export const packageItinerary = pgTable(
  "package_itinerary",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    title: varchar("title", { length: 150 }).notNull(),
    description: text("description"),
    city: varchar("city", { length: 80 }),
  },
  (t) => [index("package_itinerary_package_idx").on(t.packageId)],
);

export const packageImages = pgTable(
  "package_images",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    storageKey: varchar("storage_key", { length: 300 }).notNull().unique(),
    fileName: varchar("file_name", { length: 150 }).notNull(),
    mimeType: varchar("mime_type", { length: 50 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** 0 = cover image. */
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("package_images_package_idx").on(t.packageId)],
);

export const packageDepartures = pgTable(
  "package_departures",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    departureDate: date("departure_date", { mode: "string" }).notNull(),
    returnDate: date("return_date", { mode: "string" }),
    bookingDeadline: date("booking_deadline", { mode: "string" }),
    /** Seats for sale; null = not limited. */
    capacity: integer("capacity"),
    /** Filled by bookings in Phase 3. */
    seatsHeld: integer("seats_held").default(0).notNull(),
    seatsSold: integer("seats_sold").default(0).notNull(),
    status: departureStatusEnum("status").default("open").notNull(),
    notes: varchar("notes", { length: 200 }),
    ...timestamps,
  },
  (t) => [index("package_departures_package_date_idx").on(t.packageId, t.departureDate)],
);

/**
 * Agent (wholesale) prices per room type and passenger type. departureId null = applies to every departure;
 * a row for a specific departure overrides the package-level price for that date.
 */
export const packageRates = pgTable(
  "package_rates",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    departureId: uuid("departure_id").references(() => packageDepartures.id, { onDelete: "cascade" }),
    roomType: roomTypeEnum("room_type").notNull(),
    paxType: paxTypeEnum("pax_type").notNull(),
    basePrice: money("base_price").notNull(),
    /** Optional suggested selling price to the public, shown to agents for reference. */
    retailPrice: money("retail_price"),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (t) => [
    index("package_rates_package_idx").on(t.packageId),
    unique("package_rates_unique").on(t.packageId, t.departureId, t.roomType, t.paxType).nullsNotDistinct(),
  ],
);

export const packageAddons = pgTable(
  "package_addons",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    price: money("price").notNull(),
    basis: chargeBasisEnum("basis").default("per_person").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (t) => [index("package_addons_package_idx").on(t.packageId)],
);

/** Every price change (package rates and agency special prices), so history is never lost. */
export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    packageId: uuid("package_id").notNull(),
    rateId: uuid("rate_id"),
    agencyId: uuid("agency_id"),
    description: varchar("description", { length: 200 }).notNull(),
    oldValue: money("old_value"),
    newValue: money("new_value"),
    changedBy: uuid("changed_by"),
    changedByName: varchar("changed_by_name", { length: 150 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("price_history_package_idx").on(t.packageId, t.createdAt)],
);

/** Documents passengers must provide, per vertical or per package (used by bookings in Phase 3). */
export const documentRequirements = pgTable("document_requirements", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  vertical: verticalEnum("vertical").notNull(),
  packageId: uuid("package_id").references(() => packages.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  isRequired: boolean("is_required").default(true).notNull(),
  /** "all" or a passenger type such as "adult". */
  appliesTo: varchar("applies_to", { length: 30 }).default("all").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

export type Vertical = (typeof verticalEnum.enumValues)[number];
export type RoomType = (typeof roomTypeEnum.enumValues)[number];
export type PaxType = (typeof paxTypeEnum.enumValues)[number];
export type Package = typeof packages.$inferSelect;
