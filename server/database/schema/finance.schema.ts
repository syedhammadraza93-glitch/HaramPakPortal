import { boolean, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { agencies } from "./agency.schema";
import { bookings } from "./booking.schema";

// ================================================================================
// Enums
// ================================================================================
export const accountTypeEnum = pgEnum("account_type", ["asset", "liability", "equity", "income", "expense"]);
export const entryTypeEnum = pgEnum("entry_type", [
  "booking_charge",
  "payment",
  "credit_note",
  "additional_charge",
  "credit_adjustment",
  "refund_payout",
  "opening_balance",
  "reversal",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["bank_transfer", "cash_deposit", "cheque", "cash", "online", "other"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "clarification", "verified", "rejected", "reversed"]);
export const financeRequestKindEnum = pgEnum("finance_request_kind", ["opening_balance", "additional_charge", "credit_adjustment", "credit_note", "refund_payout", "reversal"]);
export const financeRequestStatusEnum = pgEnum("finance_request_status", ["pending", "approved", "rejected"]);

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
};

// ================================================================================
// Chart of accounts
// ================================================================================
export const ledgerAccounts = pgTable("ledger_accounts", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  type: accountTypeEnum("type").notNull(),
  /** Accounts the posting rules need (e.g. agency_receivable, sales_umrah). Names can be changed; keys cannot. */
  systemKey: varchar("system_key", { length: 40 }).unique(),
  /** Company bank account that agents can pay into. */
  isBank: boolean("is_bank").default(false).notNull(),
  /** Shown to agents: account title, number, IBAN, branch. */
  bankDetails: text("bank_details"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps,
});

// ================================================================================
// Journal (double entry). Rows are never updated or deleted: a database trigger blocks it.
// Corrections are new entries (reversals, adjustments).
// ================================================================================
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    /** e.g. JV-2026-000001 */
    entryNumber: varchar("entry_number", { length: 30 }).notNull().unique(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    type: entryTypeEnum("type").notNull(),
    description: varchar("description", { length: 300 }).notNull(),
    agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id"),
    requestId: uuid("request_id"),
    /** For reversals: the entry this one cancels out. */
    reversalOfId: uuid("reversal_of_id"),
    currency: varchar("currency", { length: 3 }).notNull(),
    amount: money("amount").notNull(),
    createdBy: uuid("created_by"),
    createdByName: varchar("created_by_name", { length: 150 }),
    approvedBy: uuid("approved_by"),
    approvedByName: varchar("approved_by_name", { length: 150 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("journal_entries_agency_idx").on(t.agencyId, t.entryDate),
    index("journal_entries_booking_idx").on(t.bookingId),
    index("journal_entries_reversal_idx").on(t.reversalOfId),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    /** Set on agency receivable lines: this is the agency's sub-ledger. */
    agencyId: uuid("agency_id"),
    debit: money("debit").default(0).notNull(),
    credit: money("credit").default(0).notNull(),
    description: varchar("description", { length: 300 }),
  },
  (t) => [index("journal_lines_entry_idx").on(t.entryId), index("journal_lines_agency_idx").on(t.agencyId, t.accountId)],
);

/** Closed months cannot receive back-dated entries. */
export const accountingPeriods = pgTable("accounting_periods", {
  month: varchar("month", { length: 7 }).primaryKey().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow().notNull(),
  closedBy: uuid("closed_by"),
  closedByName: varchar("closed_by_name", { length: 150 }),
});

// ================================================================================
// Payments from agencies (only verified payments reach the ledger)
// ================================================================================
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    /** e.g. PAY-2026-000001 */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    method: paymentMethodEnum("method").notNull(),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    /** Company bank account the money was paid into. */
    bankAccountId: uuid("bank_account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    transactionRef: varchar("transaction_ref", { length: 100 }),
    notes: text("notes"),
    status: paymentStatusEnum("status").default("pending").notNull(),
    reviewNote: text("review_note"),
    submittedBy: uuid("submitted_by"),
    submittedByName: varchar("submitted_by_name", { length: 150 }),
    submittedByType: varchar("submitted_by_type", { length: 10 }).notNull(),
    reviewedBy: uuid("reviewed_by"),
    reviewedByName: varchar("reviewed_by_name", { length: 150 }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    journalEntryId: uuid("journal_entry_id"),
    ...timestamps,
  },
  (t) => [index("payments_agency_idx").on(t.agencyId, t.createdAt), index("payments_status_idx").on(t.status)],
);

export const paymentAttachments = pgTable("payment_attachments", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  storageKey: varchar("storage_key", { length: 300 }).notNull().unique(),
  fileName: varchar("file_name", { length: 150 }).notNull(),
  mimeType: varchar("mime_type", { length: 50 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ================================================================================
// Finance requests: every manual posting needs a second finance user to approve it (maker-checker)
// ================================================================================
export const financeRequests = pgTable(
  "finance_requests",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    /** e.g. FR-2026-000001 */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    kind: financeRequestKindEnum("kind").notNull(),
    agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    amount: money("amount").notNull(),
    /** Opening balance: true = the agency owes us (debit), false = the agency has paid in advance (credit). */
    agencyOwes: boolean("agency_owes").default(true).notNull(),
    /** Bank account for refund payouts. */
    accountId: uuid("account_id").references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    reversalOfEntryId: uuid("reversal_of_entry_id"),
    entryDate: date("entry_date", { mode: "string" }),
    /** Internal reason (staff only). */
    reason: text("reason").notNull(),
    /** Text the agency sees on its statement. */
    description: varchar("description", { length: 200 }),
    status: financeRequestStatusEnum("status").default("pending").notNull(),
    requestedBy: uuid("requested_by"),
    requestedByName: varchar("requested_by_name", { length: 150 }).notNull(),
    reviewedBy: uuid("reviewed_by"),
    reviewedByName: varchar("reviewed_by_name", { length: 150 }),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    journalEntryId: uuid("journal_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("finance_requests_status_idx").on(t.status), index("finance_requests_agency_idx").on(t.agencyId)],
);

// ================================================================================
// Suppliers and booking costs (internal; never shown to agents)
// ================================================================================
export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  /** Free text: hotel, transport, visa, airline, ground operator… */
  category: varchar("category", { length: 60 }),
  contactName: varchar("contact_name", { length: 100 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

export const bookingCosts = pgTable(
  "booking_costs",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    description: varchar("description", { length: 200 }).notNull(),
    estimatedAmount: money("estimated_amount").default(0).notNull(),
    actualAmount: money("actual_amount"),
    supplierReference: varchar("supplier_reference", { length: 100 }),
    isPaid: boolean("is_paid").default(false).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [index("booking_costs_booking_idx").on(t.bookingId)],
);

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type FinanceRequest = typeof financeRequests.$inferSelect;
