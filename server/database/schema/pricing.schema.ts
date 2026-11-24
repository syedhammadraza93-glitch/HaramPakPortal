import { boolean, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { agencies } from "./agency.schema";
import { packageRates } from "./catalogue.schema";

export const adjustmentTypeEnum = pgEnum("adjustment_type", ["percent", "fixed"]);

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
};

/**
 * Agencies are placed in a pricing group. The group's adjustment is applied to every package base price,
 * e.g. percent -2 = 2% discount, fixed 5000 = PKR 5,000 more per person.
 */
export const pricingGroups = pgTable("pricing_groups", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  code: varchar("code", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  adjustmentType: adjustmentTypeEnum("adjustment_type").default("percent").notNull(),
  adjustmentValue: numeric("adjustment_value", { precision: 12, scale: 2, mode: "number" }).default(0).notNull(),
  /** Used for agencies without a group. Only one group should be the default. */
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

/** A special price for one agency on one package rate. Wins over the pricing group. */
export const agencyRateOverrides = pgTable(
  "agency_rate_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    rateId: uuid("rate_id").notNull().references(() => packageRates.id, { onDelete: "cascade" }),
    price: money("price").notNull(),
    note: varchar("note", { length: 200 }),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [unique("agency_rate_overrides_unique").on(t.agencyId, t.rateId), index("agency_rate_overrides_rate_idx").on(t.rateId)],
);

/** Umrah visa fee and service rates. Old records are kept; the record valid on a date is the one used. */
export const visaRates = pgTable(
  "visa_rates",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    /** e.g. Adult, Child, Infant, Group */
    category: varchar("category", { length: 80 }).notNull(),
    visaFee: money("visa_fee").notNull(),
    serviceFee: money("service_fee").default(0).notNull(),
    otherCharges: money("other_charges").default(0).notNull(),
    currency: varchar("currency", { length: 3 }).default("PKR").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveTo: date("effective_to", { mode: "string" }),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [index("visa_rates_effective_idx").on(t.effectiveFrom)],
);

export const cancellationPolicies = pgTable("cancellation_policies", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

/**
 * "Cancelled N or fewer days before departure → charge X". The slab with the smallest daysBefore that is still
 * ≥ the days remaining applies; if none applies, cancellation is free.
 */
export const cancellationSlabs = pgTable(
  "cancellation_slabs",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    policyId: uuid("policy_id").notNull().references(() => cancellationPolicies.id, { onDelete: "cascade" }),
    daysBefore: integer("days_before").notNull(),
    chargeType: adjustmentTypeEnum("charge_type").notNull(),
    chargeValue: money("charge_value").notNull(),
  },
  (t) => [index("cancellation_slabs_policy_idx").on(t.policyId)],
);

export type PricingGroup = typeof pricingGroups.$inferSelect;
