import { and, asc, eq, gte, inArray, isNull, lt, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbClient, type Tx } from "../database/connection";
import {
  accountingPeriods, agencies, bookings, counters, journalEntries, journalLines, ledgerAccounts, payments,
  type Agency, type Booking, type JournalEntry,
} from "../database/schema";
import { badRequest, notFound } from "../utils/http";
import type { SystemAccountKey } from "../utils/systemAccounts";
import { logAudit } from "./audit.service";
import { getCompany, todayInCompanyTz } from "./settings.service";

export type EntryType = JournalEntry["type"];
export const r2 = (n: number) => Math.round(n * 100) / 100;

export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  booking_charge: "Booking",
  payment: "Payment received",
  credit_note: "Credit note",
  additional_charge: "Additional charge",
  credit_adjustment: "Credit adjustment",
  refund_payout: "Refund paid",
  opening_balance: "Opening balance",
  reversal: "Reversal",
};

// ================================================================================
// Accounts and numbering
// ================================================================================
const accountIds = new Map<SystemAccountKey, string>();

/** Id of a system account (seeded). Ids never change, so they are cached. */
export async function systemAccountId(client: DbClient, key: SystemAccountKey): Promise<string> {
  const cached = accountIds.get(key);
  if (cached) return cached;
  const [row] = await client.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.systemKey, key)).limit(1);
  if (!row) throw new Error(`Ledger account "${key}" is missing. Restart the server so the seed creates it.`);
  accountIds.set(key, row.id);
  return row.id;
}

/** Next number in a yearly series, e.g. JV-2026-000001. Uses the counters table (row lock, no gaps on commit). */
export async function nextNumber(tx: Tx, prefix: "JV" | "PAY" | "FR" | "INV"): Promise<string> {
  const year = new Date().getFullYear();
  const [c] = await tx
    .insert(counters)
    .values({ name: `${prefix.toLowerCase()}_${year}`, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${prefix}-${year}-${String(c!.value).padStart(6, "0")}`;
}

/** The ledger is kept in the company currency from Settings. */
export async function ledgerCurrency(): Promise<string> {
  return (await getCompany()).currency;
}

// ================================================================================
// Posting
// ================================================================================
export interface PostLine {
  accountId: string;
  /** Required on agency receivable lines: it makes the agency's sub-ledger. */
  agencyId?: string | null;
  debit?: number;
  credit?: number;
  description?: string | null;
}

export interface Person {
  id: string | null;
  name: string;
  email?: string;
}

export interface PostInput {
  type: EntryType;
  entryDate?: string;
  description: string;
  agencyId?: string | null;
  bookingId?: string | null;
  paymentId?: string | null;
  requestId?: string | null;
  reversalOfId?: string | null;
  lines: PostLine[];
  createdBy: Person;
  approvedBy?: Person | null;
}

async function assertOpenMonth(client: DbClient, entryDate: string) {
  const [closed] = await client.select({ month: accountingPeriods.month }).from(accountingPeriods).where(eq(accountingPeriods.month, entryDate.slice(0, 7))).limit(1);
  if (closed) throw badRequest(`${entryDate.slice(0, 7)} is closed. Use a date in an open month.`, [{ path: "entryDate", message: "This month is closed" }]);
}

/** Validates an entry date chosen by a person: not in the future, not in a closed month. */
export async function checkEntryDate(client: DbClient, entryDate: string | null | undefined): Promise<string> {
  const today = await todayInCompanyTz();
  const d = entryDate || today;
  if (d > today) throw badRequest("The entry date cannot be in the future", [{ path: "entryDate", message: "Use today or an earlier date" }]);
  await assertOpenMonth(client, d);
  return d;
}

/**
 * Posts one balanced journal entry. The database also checks the balance and the closed months, and refuses any later
 * change to the rows; corrections are made with new entries.
 */
export async function postEntry(tx: Tx, input: PostInput): Promise<JournalEntry> {
  const lines = input.lines
    .map((l) => ({ ...l, debit: r2(l.debit ?? 0), credit: r2(l.credit ?? 0) }))
    .filter((l) => l.debit > 0 || l.credit > 0);
  const debit = r2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (lines.length < 2 || debit <= 0 || debit !== credit) throw new Error(`Unbalanced journal entry (${debit} / ${credit})`);
  const entryDate = input.entryDate ?? (await todayInCompanyTz());
  await assertOpenMonth(tx, entryDate);

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      entryNumber: await nextNumber(tx, "JV"),
      entryDate,
      type: input.type,
      description: input.description.slice(0, 300),
      agencyId: input.agencyId ?? null,
      bookingId: input.bookingId ?? null,
      paymentId: input.paymentId ?? null,
      requestId: input.requestId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      currency: await ledgerCurrency(),
      amount: debit,
      createdBy: input.createdBy.id,
      createdByName: input.createdBy.name,
      approvedBy: input.approvedBy?.id ?? null,
      approvedByName: input.approvedBy?.name ?? null,
    })
    .returning();
  await tx.insert(journalLines).values(
    lines.map((l) => ({ entryId: entry!.id, accountId: l.accountId, agencyId: l.agencyId ?? null, debit: l.debit, credit: l.credit, description: l.description?.slice(0, 300) ?? null })),
  );
  await logAudit(
    {
      action: "ledger.posted",
      entityType: "journal_entry",
      entityId: entry!.id,
      newValues: { entryNumber: entry!.entryNumber, type: entry!.type, amount: debit, agencyId: entry!.agencyId, bookingId: entry!.bookingId, description: entry!.description },
      actor: input.createdBy.id && input.createdBy.email ? { id: input.createdBy.id, email: input.createdBy.email } : undefined,
    },
    tx,
  );
  return entry!;
}

/** The two lines of an entry that moves money between the agency's account and one other account. */
export async function agencyLines(client: DbClient, agencyId: string, otherAccountId: string, amount: number, agencyOwesMore: boolean, description?: string): Promise<PostLine[]> {
  const recv = await systemAccountId(client, "agency_receivable");
  return agencyOwesMore
    ? [{ accountId: recv, agencyId, debit: amount, description }, { accountId: otherAccountId, credit: amount, description }]
    : [{ accountId: otherAccountId, debit: amount, description }, { accountId: recv, agencyId, credit: amount, description }];
}

/** Lines of an entry turned around (for reversals). */
export async function reversedLines(client: DbClient, entryId: string): Promise<PostLine[]> {
  const lines = await client.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  return lines.map((l) => ({ accountId: l.accountId, agencyId: l.agencyId, debit: l.credit, credit: l.debit, description: l.description }));
}

// ================================================================================
// Balances and credit
// ================================================================================

/** What the agency owes the company. Negative = the agency has money with the company (advance or credit). */
export async function agencyBalance(client: DbClient, agencyId: string): Promise<number> {
  const recv = await systemAccountId(client, "agency_receivable");
  const [row] = await client
    .select({ balance: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .where(and(eq(journalLines.accountId, recv), eq(journalLines.agencyId, agencyId)));
  return r2(Number(row?.balance ?? 0));
}

export interface CreditInfo {
  currency: string;
  balance: number;
  paymentTerms: Agency["paymentTerms"];
  creditLimit: number;
  creditPolicy: Agency["creditPolicy"];
  paymentTermsDays: number;
  /** How much more the agency can book without paying: credit agencies up to their limit, advance agencies their deposit. */
  available: number;
  pendingPayments: number;
}

export async function creditInfo(client: DbClient, agency: Pick<Agency, "id" | "paymentTerms" | "creditLimit" | "creditPolicy" | "paymentTermsDays">): Promise<CreditInfo> {
  const balance = await agencyBalance(client, agency.id);
  const [pending] = await client
    .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(and(eq(payments.agencyId, agency.id), inArray(payments.status, ["pending", "clarification"])));
  const creditLimit = Number(agency.creditLimit);
  return {
    currency: await ledgerCurrency(),
    balance,
    paymentTerms: agency.paymentTerms,
    creditLimit,
    creditPolicy: agency.creditPolicy,
    paymentTermsDays: agency.paymentTermsDays,
    available: r2(agency.paymentTerms === "credit" ? creditLimit - balance : -balance),
    pendingPayments: r2(Number(pending?.total ?? 0)),
  };
}

/** Locks the agency row so two confirmations cannot both use the same credit. */
export async function lockAgency(tx: Tx, agencyId: string): Promise<Agency> {
  const [row] = await tx.select().from(agencies).where(eq(agencies.id, agencyId)).for("update").limit(1);
  if (!row) throw notFound("Agency not found");
  return row;
}

export interface CreditCheck {
  amount: number;
  available: number;
  shortBy: number;
  withinCredit: boolean;
  policy: Agency["creditPolicy"];
}

export function checkCredit(info: CreditInfo, amount: number): CreditCheck {
  const shortBy = r2(Math.max(0, amount - info.available));
  return { amount, available: info.available, shortBy, withinCredit: shortBy === 0, policy: info.creditPolicy };
}

// ================================================================================
// Booking postings
// ================================================================================
const SALES_ACCOUNT: Record<Booking["vertical"], SystemAccountKey> = { umrah: "sales_umrah", hajj: "sales_hajj", tourism: "sales_tourism" };

/** Booking confirmed: the agency is charged the booking total. */
export async function postBookingCharge(tx: Tx, b: Booking, actor: Person): Promise<JournalEntry | null> {
  const total = r2(Number(b.totalAmount));
  if (total <= 0) return null;
  const currency = await ledgerCurrency();
  if (b.currency !== currency) {
    throw badRequest(`This booking is priced in ${b.currency}, but the ledger is kept in ${currency}. Change the package price to ${currency} or the ledger currency in Settings before confirming.`);
  }
  const description = `Booking ${b.reference} · ${b.packageName} · ${b.paxCount} pax`;
  // The booking gets its sales invoice number when it is charged.
  await tx.update(bookings).set({ invoiceNumber: await nextNumber(tx, "INV"), invoicedAt: new Date() }).where(and(eq(bookings.id, b.id), isNull(bookings.invoiceNumber)));
  return postEntry(tx, {
    type: "booking_charge",
    description,
    agencyId: b.agencyId,
    bookingId: b.id,
    lines: await agencyLines(tx, b.agencyId, await systemAccountId(tx, SALES_ACCOUNT[b.vertical]), total, true, description),
    createdBy: actor,
  });
}

/** Amount charged to the agency for a booking that has not been reversed. */
export async function chargedForBooking(client: DbClient, bookingId: string): Promise<number> {
  const rev = alias(journalEntries, "rev");
  const [row] = await client
    .select({ total: sql<string>`coalesce(sum(${journalEntries.amount}), 0)` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.bookingId, bookingId),
        eq(journalEntries.type, "booking_charge"),
        notExists(client.select({ x: sql`1` }).from(rev).where(eq(rev.reversalOfId, journalEntries.id))),
      ),
    );
  return r2(Number(row?.total ?? 0));
}

// ================================================================================
// Statement
// ================================================================================
export interface StatementLine {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  type: EntryType;
  typeLabel: string;
  description: string;
  bookingId: string | null;
  bookingReference: string | null;
  paymentReference: string | null;
  debit: number;
  credit: number;
  balance: number;
}

/** Agency statement between two dates (inclusive), with the balance brought forward and a running balance. */
export async function agencyStatement(agencyId: string, from: string, to: string) {
  const recv = await systemAccountId(db, "agency_receivable");
  const mine = and(eq(journalLines.accountId, recv), eq(journalLines.agencyId, agencyId));
  const [opening] = await db
    .select({ balance: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(mine, lt(journalEntries.entryDate, from)));
  const rows = await db
    .select({
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
      type: journalEntries.type,
      description: journalEntries.description,
      bookingId: journalEntries.bookingId,
      bookingReference: sql<string | null>`(select b.reference from bookings b where b.id = ${journalEntries.bookingId})`,
      paymentReference: sql<string | null>`(select p.reference from payments p where p.id = ${journalEntries.paymentId})`,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(mine, gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt), asc(journalEntries.entryNumber));

  let running = r2(Number(opening?.balance ?? 0));
  const openingBalance = running;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines: StatementLine[] = rows.map((r) => {
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    totalDebit += debit;
    totalCredit += credit;
    running = r2(running + debit - credit);
    return { ...r, typeLabel: ENTRY_TYPE_LABEL[r.type], debit, credit, balance: running };
  });
  return { currency: await ledgerCurrency(), from, to, openingBalance, totalDebit: r2(totalDebit), totalCredit: r2(totalCredit), closingBalance: running, lines };
}

/** Default statement range: the first day of last month to today. */
export async function defaultRange(): Promise<{ from: string; to: string }> {
  const today = await todayInCompanyTz();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1, 1);
  return { from: d.toISOString().slice(0, 10), to: today };
}
