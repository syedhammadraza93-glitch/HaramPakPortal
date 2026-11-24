import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./identity.schema";

// ================================================================================
// Document templates: the text around each generated PDF (titles, intro, terms). Branding comes from Settings.
// ================================================================================
export const documentTemplates = pgTable("document_templates", {
  /** quotation, proforma_invoice, sales_invoice, payment_receipt, credit_note, booking_confirmation, travel_voucher, passenger_list, ledger_statement, brochure */
  type: varchar("type", { length: 40 }).primaryKey().notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  /** Shown under the title. */
  introText: text("intro_text"),
  /** Terms, bank details or notes printed at the end. */
  footerText: text("footer_text"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  updatedBy: uuid("updated_by"),
});

// ================================================================================
// In-portal notifications (one row per user)
// ================================================================================
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** e.g. booking_update, payment_update, new_package, price_change, announcement, balance_reminder */
    type: varchar("type", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    /** Portal path to open, e.g. /agent/bookings/… */
    link: varchar("link", { length: 300 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_unread_idx").on(t.userId, t.readAt)],
);

// ================================================================================
// Announcements to agents
// ================================================================================
export const announcementAudienceEnum = pgEnum("announcement_audience", ["all", "agencies", "pricing_groups"]);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    audience: announcementAudienceEnum("audience").default("all").notNull(),
    agencyIds: jsonb("agency_ids").$type<string[]>().default([]).notNull(),
    pricingGroupIds: jsonb("pricing_group_ids").$type<string[]>().default([]).notNull(),
    /** Shown on agent dashboards between these times (no end = until removed). */
    startsAt: timestamp("starts_at", { withTimezone: true }).defaultNow().notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    /** Set once the agents have been notified (in-portal and, if chosen, by email). */
    sendEmail: boolean("send_email").default(false).notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdByName: varchar("created_by_name", { length: 150 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [index("announcements_active_idx").on(t.isActive, t.startsAt)],
);

export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
