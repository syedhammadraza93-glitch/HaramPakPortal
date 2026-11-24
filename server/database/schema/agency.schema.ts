import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import { pricingGroups } from "./pricing.schema";

// ================================================================================
// Enums
// ================================================================================
export const agencyStatusEnum = pgEnum("agency_status", [
  "pending_email_verification",
  "pending_approval",
  "information_required",
  "active",
  "suspended",
  "rejected",
  "deactivated",
]);

export const paymentTermsEnum = pgEnum("payment_terms", ["advance", "credit"]);
export const creditPolicyEnum = pgEnum("credit_policy", ["warn", "block"]);

export const documentTypeEnum = pgEnum("document_type", ["cnic_copy", "licence", "registration_cert", "other"]);

// ================================================================================
// Agencies (registered travel agents)
// ================================================================================
export type AgencyAccess = { catalogue: boolean; bookings: boolean; finance: boolean };

export const agencies = pgTable(
  "agencies",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    /** Assigned on first approval, e.g. AGT-00001. Never reused. */
    agentCode: varchar("agent_code", { length: 20 }).unique(),
    agencyName: varchar("agency_name", { length: 150 }).notNull(),
    authorizedPerson: varchar("authorized_person", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    whatsapp: varchar("whatsapp", { length: 30 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    address: varchar("address", { length: 300 }).notNull(),
    city: varchar("city", { length: 80 }).notNull(),
    country: varchar("country", { length: 80 }).default("Pakistan").notNull(),
    cnic: varchar("cnic", { length: 15 }),
    ntn: varchar("ntn", { length: 50 }),
    businessRegNo: varchar("business_reg_no", { length: 50 }),
    licenceNo: varchar("licence_no", { length: 50 }),
    status: agencyStatusEnum("status").default("pending_email_verification").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    termsVersion: varchar("terms_version", { length: 20 }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    /** Commercial terms (Phase 2): pricing group and an internal category such as A / B / C. */
    pricingGroupId: uuid("pricing_group_id").references((): AnyPgColumn => pricingGroups.id, { onDelete: "set null" }),
    agentCategory: varchar("agent_category", { length: 50 }),
    /** Credit control (Phase 4). advance = pays before travel; credit = may owe up to creditLimit. */
    paymentTerms: paymentTermsEnum("payment_terms").default("advance").notNull(),
    creditLimit: numeric("credit_limit", { precision: 14, scale: 2, mode: "number" }).default(0).notNull(),
    /** What happens when a booking would exceed the available credit. */
    creditPolicy: creditPolicyEnum("credit_policy").default("block").notNull(),
    /** Days allowed to pay for credit agencies (shown on statements). */
    paymentTermsDays: integer("payment_terms_days").default(0).notNull(),
    portalAccess: jsonb("portal_access").$type<AgencyAccess>().notNull().default({ catalogue: true, bookings: true, finance: true }),
    lastBalanceReminderAt: timestamp("last_balance_reminder_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    version: integer("version").default(0).notNull(),
  },
  (t) => [
    index("agencies_status_idx").on(t.status),
    index("agencies_phone_idx").on(t.phone),
    index("agencies_cnic_idx").on(t.cnic),
  ],
);

export const agencyDocuments = pgTable(
  "agency_documents",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    docType: documentTypeEnum("doc_type").notNull(),
    fileName: varchar("file_name", { length: 150 }).notNull(),
    storageKey: varchar("storage_key", { length: 300 }).notNull().unique(),
    mimeType: varchar("mime_type", { length: 50 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by"),
    verified: boolean("verified").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agency_documents_agency_id_idx").on(t.agencyId)],
);

export const agencyStatusHistory = pgTable(
  "agency_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    fromStatus: agencyStatusEnum("from_status"),
    toStatus: agencyStatusEnum("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by"),
    changedByName: varchar("changed_by_name", { length: 150 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agency_status_history_agency_id_idx").on(t.agencyId)],
);

/** Internal staff notes. Never shown to the agent. */
export const agencyNotes = pgTable(
  "agency_notes",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdByName: varchar("created_by_name", { length: 150 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agency_notes_agency_id_idx").on(t.agencyId)],
);

export type Agency = typeof agencies.$inferSelect;
export type AgencyStatus = (typeof agencyStatusEnum.enumValues)[number];
export type DocumentType = (typeof documentTypeEnum.enumValues)[number];
