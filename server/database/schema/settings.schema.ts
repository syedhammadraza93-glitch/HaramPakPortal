import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const fieldModeEnum = pgEnum("field_mode", ["required", "optional", "hidden"]);

/** Required / Optional / Hidden setting for configurable sign-up fields. */
export const registrationFieldSettings = pgTable("registration_field_settings", {
  field: varchar("field", { length: 50 }).primaryKey().notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  mode: fieldModeEnum("mode").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});

/**
 * Single-row table (id = 1): company details and branding used by the portal, emails and documents.
 * Everything here is edited by the admin in Settings; nothing about the company is hard-coded in the app.
 */
export const companySettings = pgTable("company_settings", {
  id: integer("id").primaryKey().default(1).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  address: text("address"),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 255 }),
  website: varchar("website", { length: 200 }),
  timezone: varchar("timezone", { length: 50 }).default("Asia/Karachi").notNull(),
  currency: varchar("currency", { length: 3 }).default("PKR").notNull(),
  termsVersion: varchar("terms_version", { length: 20 }).default("1.0").notNull(),
  /** Hours a submitted booking holds its seats before Operations must confirm it. */
  seatHoldHours: integer("seat_hold_hours").default(48).notNull(),
  /** Passports must be valid at least this many months after the return date (0 = only check expiry). */
  passportValidityMonths: integer("passport_validity_months").default(6).notNull(),
  // ---- Branding ----
  /** e.g. "Agent Portal" (shown under the company name). */
  portalName: varchar("portal_name", { length: 80 }).default("Agent Portal").notNull(),
  tagline: varchar("tagline", { length: 150 }),
  /** Heading and text on the login / sign-up brand panel. */
  heroTitle: varchar("hero_title", { length: 150 }),
  aboutText: text("about_text"),
  highlights: jsonb("highlights").$type<string[]>().default([]).notNull(),
  footerText: varchar("footer_text", { length: 200 }),
  logoKey: varchar("logo_key", { length: 300 }),
  logoMime: varchar("logo_mime", { length: 50 }),
  /** Hex colours, e.g. #00944A. The portal derives lighter/darker shades from them. */
  primaryColor: varchar("primary_color", { length: 7 }).default("#0F766E").notNull(),
  accentColor: varchar("accent_color", { length: 7 }).default("#DC2626").notNull(),
  highlightColor: varchar("highlight_color", { length: 7 }).default("#F59E0B").notNull(),
  /** Cities suggested on the agent sign-up form. */
  cities: jsonb("cities").$type<string[]>().default([]).notNull(),
  /** Notifications (Phase 5): which agent alerts are also emailed, and how often balance reminders go out (0 = never). */
  emailNewPackages: boolean("email_new_packages").default(true).notNull(),
  emailPriceChanges: boolean("email_price_changes").default(false).notNull(),
  balanceReminderDays: integer("balance_reminder_days").default(7).notNull(),
  // ---- Security ----
  /** Two-factor login (a 6-digit code emailed at every login) for the whole portal. Off = nobody is asked for a code. */
  twoFactorEnabled: boolean("two_factor_enabled").default(true).notNull(),
  /** Role codes that must use two-factor login while it is on. Users with other roles may turn it on for themselves. */
  twoFactorRoles: jsonb("two_factor_roles").$type<string[]>().default(["SUPER_ADMIN", "FINANCE_MANAGER"]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});

/** Named sequences, e.g. agent_code. Incremented atomically. */
export const counters = pgTable("counters", {
  name: varchar("name", { length: 50 }).primaryKey().notNull(),
  value: integer("value").default(0).notNull(),
});

export type FieldMode = (typeof fieldModeEnum.enumValues)[number];
