import { boolean, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { agencies } from "./agency.schema";
import { chargeBasisEnum, documentRequirements, packageAddons, packageDepartures, packages, paxTypeEnum, roomTypeEnum, verticalEnum } from "./catalogue.schema";
import { adjustmentTypeEnum } from "./pricing.schema";

// ================================================================================
// Enums
// ================================================================================
export const bookingStatusEnum = pgEnum("booking_status", [
  "draft",
  "submitted",
  "under_review",
  "information_required",
  "quotation_sent",
  "awaiting_payment",
  "payment_pending_verification",
  "confirmed",
  "processing",
  "documents_issued",
  "completed",
  "cancelled",
  "rejected",
  "refunded",
]);
export const genderEnum = pgEnum("gender", ["male", "female"]);
export const bookingDocStatusEnum = pgEnum("booking_doc_status", ["pending", "verified", "rejected"]);
export const priceLineKindEnum = pgEnum("price_line_kind", ["fare", "addon", "charge", "quotation", "adjustment"]);
export const actorTypeEnum = pgEnum("actor_type", ["staff", "agent", "system"]);

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
};

// ================================================================================
// Bookings
// ================================================================================
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    /** e.g. BKG-2026-000123, given when the booking is first submitted. Drafts have none. */
    reference: varchar("reference", { length: 30 }).unique(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").notNull(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "restrict" }),
    departureId: uuid("departure_id").references(() => packageDepartures.id, { onDelete: "restrict" }),
    // Snapshot of what was booked, so later package changes never alter it.
    vertical: verticalEnum("vertical").notNull(),
    packageCode: varchar("package_code", { length: 20 }).notNull(),
    packageName: varchar("package_name", { length: 200 }).notNull(),
    departureDate: date("departure_date", { mode: "string" }),
    returnDate: date("return_date", { mode: "string" }),
    status: bookingStatusEnum("status").default("draft").notNull(),
    /** On-request package: the agent asks for a quotation instead of booking a listed date. */
    isQuotation: boolean("is_quotation").default(false).notNull(),
    requestedDates: varchar("requested_dates", { length: 200 }),
    agentNotes: text("agent_notes"),
    /** The agency's own reference for its customer. */
    agentReference: varchar("agent_reference", { length: 60 }),
    paxCount: integer("pax_count").default(0).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    subtotal: money("subtotal").default(0).notNull(),
    chargesTotal: money("charges_total").default(0).notNull(),
    totalAmount: money("total_amount").default(0).notNull(),
    quoteValidUntil: date("quote_valid_until", { mode: "string" }),
    /** Seats held on the departure (released if not confirmed in time). */
    seatsHeld: integer("seats_held").default(0).notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    /** Seats counted as sold after confirmation. */
    seatsSold: integer("seats_sold").default(0).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** Charge under the package's cancellation policy, worked out when cancelled after confirmation. */
    /** Sales invoice number, assigned when the booking is charged to the agency (INV-YYYY-000001). */
    invoiceNumber: varchar("invoice_number", { length: 30 }).unique(),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    cancellationCharge: money("cancellation_charge"),
    ...timestamps,
    version: integer("version").default(0).notNull(),
  },
  (t) => [
    index("bookings_agency_idx").on(t.agencyId, t.createdAt),
    index("bookings_status_idx").on(t.status),
    index("bookings_departure_idx").on(t.departureId),
  ],
);

export const bookingPassengers = pgTable(
  "booking_passengers",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").default(0).notNull(),
    /** Full name exactly as in the passport. */
    fullName: varchar("full_name", { length: 150 }).notNull(),
    gender: genderEnum("gender"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    nationality: varchar("nationality", { length: 60 }),
    passportNumber: varchar("passport_number", { length: 30 }),
    passportIssueDate: date("passport_issue_date", { mode: "string" }),
    passportExpiryDate: date("passport_expiry_date", { mode: "string" }),
    paxType: paxTypeEnum("pax_type").default("adult").notNull(),
    roomType: roomTypeEnum("room_type"),
    phone: varchar("phone", { length: 30 }),
    notes: varchar("notes", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_passengers_booking_idx").on(t.bookingId)],
);

/** Add-ons chosen by the agent (quantity = people or 1 for per-booking add-ons). */
export const bookingAddons = pgTable(
  "booking_addons",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    addonId: uuid("addon_id").notNull().references(() => packageAddons.id, { onDelete: "restrict" }),
    quantity: integer("quantity").default(1).notNull(),
  },
  (t) => [unique("booking_addons_unique").on(t.bookingId, t.addonId)],
);

/** The price breakdown frozen at submission (or set by Operations for a quotation). */
export const bookingPriceLines = pgTable(
  "booking_price_lines",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    kind: priceLineKindEnum("kind").notNull(),
    description: varchar("description", { length: 250 }).notNull(),
    quantity: integer("quantity").default(1).notNull(),
    unitAmount: money("unit_amount").notNull(),
    amount: money("amount").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (t) => [index("booking_price_lines_booking_idx").on(t.bookingId)],
);

/** Passenger documents uploaded by the agent, and travel documents issued by the company (issued = true). */
export const bookingDocuments = pgTable(
  "booking_documents",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    passengerId: uuid("passenger_id").references(() => bookingPassengers.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id").references(() => documentRequirements.id, { onDelete: "set null" }),
    name: varchar("name", { length: 150 }).notNull(),
    issued: boolean("issued").default(false).notNull(),
    storageKey: varchar("storage_key", { length: 300 }).notNull().unique(),
    fileName: varchar("file_name", { length: 150 }).notNull(),
    mimeType: varchar("mime_type", { length: 50 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: bookingDocStatusEnum("status").default("pending").notNull(),
    reviewNote: varchar("review_note", { length: 300 }),
    uploadedBy: uuid("uploaded_by"),
    uploadedByType: actorTypeEnum("uploaded_by_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_documents_booking_idx").on(t.bookingId)],
);

export const bookingStatusHistory = pgTable(
  "booking_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    fromStatus: bookingStatusEnum("from_status"),
    toStatus: bookingStatusEnum("to_status").notNull(),
    reason: text("reason"),
    actorType: actorTypeEnum("actor_type").notNull(),
    changedBy: uuid("changed_by"),
    changedByName: varchar("changed_by_name", { length: 150 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_status_history_booking_idx").on(t.bookingId)],
);

/** Conversation between the agent and Operations. Internal messages are never shown to the agent. */
export const bookingMessages = pgTable(
  "booking_messages",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    authorType: actorTypeEnum("author_type").notNull(),
    authorId: uuid("author_id"),
    authorName: varchar("author_name", { length: 150 }).notNull(),
    message: text("message").notNull(),
    isInternal: boolean("is_internal").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_messages_booking_idx").on(t.bookingId, t.createdAt)],
);

// ================================================================================
// Configuration
// ================================================================================

/** Taxes and charges added to every booking price (set by the admin; none by default). */
export const chargeRules = pgTable("charge_rules", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  /** null = all product types */
  vertical: verticalEnum("vertical"),
  chargeType: adjustmentTypeEnum("charge_type").notNull(),
  /** Percent of the fare + add-ons subtotal, or a fixed amount. */
  value: money("value").notNull(),
  /** For fixed amounts: per passenger or once per booking. */
  basis: chargeBasisEnum("basis").default("per_booking").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps,
});

/** Operational steps per product type (e.g. Hajj: documents checked, visa applied, visa issued…). */
export const bookingStages = pgTable("booking_stages", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  vertical: verticalEnum("vertical").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

export const bookingStageProgress = pgTable(
  "booking_stage_progress",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").notNull().references(() => bookingStages.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
    completedBy: uuid("completed_by"),
    completedByName: varchar("completed_by_name", { length: 150 }),
    note: varchar("note", { length: 300 }),
  },
  (t) => [unique("booking_stage_progress_unique").on(t.bookingId, t.stageId)],
);

export type Booking = typeof bookings.$inferSelect;
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
