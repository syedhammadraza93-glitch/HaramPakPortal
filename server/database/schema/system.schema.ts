import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const emailStatusEnum = pgEnum("email_status", ["pending", "sent", "failed"]);

/** Emails are queued here and delivered by a background loop with retries, so none are lost. */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    toEmail: varchar("to_email", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 300 }).notNull(),
    html: text("html").notNull(),
    status: emailStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("email_outbox_status_created_idx").on(t.status, t.createdAt)],
);

/** Append-only record of who did what, on which record, from where. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id"),
    userEmail: varchar("user_email", { length: 255 }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: varchar("entity_id", { length: 100 }),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);
