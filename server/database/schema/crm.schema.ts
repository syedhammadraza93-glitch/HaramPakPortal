import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.schema";

const date = (name: string) => timestamp(name, { withTimezone: true });
export const leadStages = ["new", "contacted", "qualified", "quoted", "follow_up", "booked", "lost"] as const;
export type LeadStage = typeof leadStages[number];
export const leadSources = ["website", "phone", "whatsapp", "office_visit", "agency_referral", "social", "other"] as const;

export const leads = pgTable("crm_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  city: text("city"),
  service: text("service").notNull(),
  packageSlug: text("package_slug"),
  travelDate: text("travel_date"),
  travellers: integer("travellers"),
  source: text("source").$type<typeof leadSources[number]>().notNull(),
  campaign: text("campaign"),
  stage: text("stage").$type<LeadStage>().notNull().default("new"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  firstResponseDueAt: date("first_response_due_at").notNull(),
  firstContactAt: date("first_contact_at"),
  nextFollowUpAt: date("next_follow_up_at"),
  escalatedAt: date("escalated_at"),
  bookingReference: text("booking_reference"),
  lossReason: text("loss_reason"),
  version: integer("version").default(0).notNull(),
  createdAt: date("created_at").defaultNow().notNull(),
  updatedAt: date("updated_at").defaultNow().notNull(),
}, t => [index("crm_leads_owner_stage").on(t.ownerId, t.stage), index("crm_leads_created").on(t.createdAt), index("crm_leads_phone").on(t.phone)]);

export const leadEvents = pgTable("crm_lead_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  details: text("details").notNull(),
  createdAt: date("created_at").defaultNow().notNull(),
}, t => [index("crm_lead_events_lead_date").on(t.leadId, t.createdAt)]);

export type QuoteLine = { label: string; quantity: number; unitMinor: number };
export const leadQuotes = pgTable("crm_lead_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  customerName: text("customer_name").notNull(),
  currency: text("currency").notNull(),
  validUntil: text("valid_until").notNull(),
  lines: jsonb("lines").$type<QuoteLine[]>().notNull(),
  terms: text("terms").notNull(),
  issuedAt: date("issued_at").defaultNow().notNull(),
  issuedBy: uuid("issued_by").references(() => users.id, { onDelete: "set null" }),
  sentAt: date("sent_at"),
}, t => [unique("crm_lead_quote_revision").on(t.leadId, t.revision)]);

export const crmSettings = pgTable("crm_settings", {
  id: integer("id").primaryKey(),
  firstResponseMinutes: integer("first_response_minutes").notNull().default(60),
  followUpMinutes: integer("follow_up_minutes").notNull().default(1440),
});

export const websiteSections = pgTable("website_sections", {
  key: text("key").primaryKey(),
  draft: jsonb("draft").notNull(),
  published: jsonb("published"),
  version: integer("version").notNull().default(1),
  updatedAt: date("updated_at").defaultNow().notNull(),
  publishedAt: date("published_at"),
});
