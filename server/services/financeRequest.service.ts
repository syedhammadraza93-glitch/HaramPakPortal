import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "../database/connection";
import { agencies, bookings, financeRequests, journalEntries, ledgerAccounts, payments, type Booking, type FinanceRequest } from "../database/schema";
import { mailTemplates } from "../utils/emails/templates";
import { badRequest, conflict, forbidden, notFound } from "../utils/http";
import type { SystemAccountKey } from "../utils/systemAccounts";
import { logAudit } from "./audit.service";
import { setBookingStatus } from "./booking.service";
import {
  ENTRY_TYPE_LABEL, agencyBalance, agencyLines, chargedForBooking, checkEntryDate, ledgerCurrency, lockAgency, nextNumber, postEntry, r2, reversedLines,
  systemAccountId, type Person, type PostLine,
} from "./ledger.service";
import { frontendUrl, getMailBrand, queueEmail, queueEmailToPermission } from "./mail.service";
import { notifyAgency } from "./notification.service";

export type RequestKind = FinanceRequest["kind"];

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  opening_balance: "Opening balance",
  additional_charge: "Additional charge",
  credit_adjustment: "Credit adjustment",
  credit_note: "Credit note",
  refund_payout: "Refund payout",
  reversal: "Reversal",
};

/** Account on the other side of the agency line, and whether the agency ends up owing more. */
const COUNTER_ACCOUNT: Partial<Record<RequestKind, { key: SystemAccountKey; agencyOwesMore: boolean }>> = {
  additional_charge: { key: "other_income", agencyOwesMore: true },
  credit_adjustment: { key: "agency_discounts", agencyOwesMore: false },
  credit_note: { key: "sales_returns", agencyOwesMore: false },
};

export interface NewRequest {
  kind: RequestKind;
  agencyId?: string | null;
  bookingId?: string | null;
  amount?: number;
  agencyOwes?: boolean;
  accountId?: string | null;
  reversalOfEntryId?: string | null;
  entryDate?: string | null;
  reason: string;
  description?: string | null;
}

async function bankAccount(tx: Tx, id: string | null | undefined) {
  if (!id) throw badRequest("Choose the bank account", [{ path: "accountId", message: "Required" }]);
  const [acc] = await tx.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.isBank, true))).limit(1);
  if (!acc) throw badRequest("Choose one of the company bank accounts", [{ path: "accountId", message: "Not a bank account" }]);
  if (!acc.isActive) throw badRequest("This bank account is inactive", [{ path: "accountId", message: "Inactive" }]);
  return acc;
}

/** Creates a request that a second finance user must approve before anything reaches the ledger. */
export async function createFinanceRequest(tx: Tx, input: NewRequest, requester: Person, notify = true): Promise<FinanceRequest> {
  let amount = r2(input.amount ?? 0);
  let agencyId = input.agencyId ?? null;
  let bookingId = input.bookingId ?? null;
  // Without a date the entry is dated on the day it is approved.
  const entryDate = input.entryDate ? await checkEntryDate(tx, input.entryDate) : null;

  if (input.kind === "reversal") {
    if (!input.reversalOfEntryId) throw badRequest("Choose the entry to reverse");
    const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, input.reversalOfEntryId)).limit(1);
    if (!entry) throw notFound("Journal entry not found");
    if (entry.type === "reversal") throw badRequest("A reversal cannot be reversed. Post a new adjustment instead.");
    const [done] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.reversalOfId, entry.id)).limit(1);
    if (done) throw conflict(`${entry.entryNumber} has already been reversed`);
    const [pending] = await tx
      .select({ ref: financeRequests.reference })
      .from(financeRequests)
      .where(and(eq(financeRequests.reversalOfEntryId, entry.id), eq(financeRequests.status, "pending")))
      .limit(1);
    if (pending) throw conflict(`A reversal of ${entry.entryNumber} is already waiting for approval (${pending.ref})`);
    amount = Number(entry.amount);
    agencyId = entry.agencyId;
    bookingId = entry.bookingId;
  } else {
    if (!agencyId) throw badRequest("Choose the agency", [{ path: "agencyId", message: "Required" }]);
    if (amount <= 0) throw badRequest("Enter an amount greater than zero", [{ path: "amount", message: "Must be more than 0" }]);
    const [agency] = await tx.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
    if (!agency) throw notFound("Agency not found");
  }

  if (bookingId && input.kind !== "reversal") {
    const [b] = await tx.select({ agencyId: bookings.agencyId }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!b || b.agencyId !== agencyId) throw badRequest("The booking does not belong to this agency", [{ path: "bookingId", message: "Wrong booking" }]);
  }
  if (input.kind === "opening_balance") {
    const [existing] = await tx
      .select({ ref: financeRequests.reference })
      .from(financeRequests)
      .where(and(eq(financeRequests.agencyId, agencyId!), eq(financeRequests.kind, "opening_balance"), inArray(financeRequests.status, ["pending", "approved"])))
      .limit(1);
    if (existing) throw conflict(`This agency already has an opening balance (${existing.ref}). Use an additional charge or a credit adjustment instead.`);
  }
  if (input.kind === "credit_note" && bookingId) {
    const charged = await chargedForBooking(tx, bookingId);
    if (amount > charged) throw badRequest(`The credit note cannot be more than the amount charged for the booking (${charged.toLocaleString("en-US")})`, [{ path: "amount", message: "Too high" }]);
    const [pending] = await tx
      .select({ ref: financeRequests.reference })
      .from(financeRequests)
      .where(and(eq(financeRequests.bookingId, bookingId), eq(financeRequests.kind, "credit_note"), eq(financeRequests.status, "pending")))
      .limit(1);
    if (pending) throw conflict(`A credit note for this booking is already waiting for approval (${pending.ref})`);
  }
  if (input.kind === "refund_payout") await bankAccount(tx, input.accountId);

  const [row] = await tx
    .insert(financeRequests)
    .values({
      reference: await nextNumber(tx, "FR"),
      kind: input.kind,
      agencyId,
      bookingId,
      amount,
      agencyOwes: input.kind === "opening_balance" ? input.agencyOwes !== false : true,
      accountId: input.kind === "refund_payout" ? input.accountId! : null,
      reversalOfEntryId: input.kind === "reversal" ? input.reversalOfEntryId! : null,
      entryDate,
      reason: input.reason,
      description: input.description?.trim() || null,
      requestedBy: requester.id,
      requestedByName: requester.name,
    })
    .returning();
  await logAudit(
    { action: "finance.request_created", entityType: "finance_request", entityId: row!.id, newValues: { reference: row!.reference, kind: row!.kind, amount, agencyId, bookingId, reason: input.reason }, actor: requester.id && requester.email ? { id: requester.id, email: requester.email } : undefined },
    tx,
  );
  if (notify) {
    const currency = await ledgerCurrency();
    void queueEmailToPermission(
      "finance.approve",
      mailTemplates.financeForStaff(await getMailBrand(), `${REQUEST_KIND_LABEL[row!.kind]} waiting for approval: ${row!.reference}`, [`Amount: ${currency} ${amount.toLocaleString("en-US")}`, `Requested by ${requester.name}`, `Reason: ${input.reason}`], frontendUrl("/admin/finance?tab=approvals")),
      { type: "finance_request", title: `${REQUEST_KIND_LABEL[row!.kind]} to approve: ${currency} ${amount.toLocaleString("en-US")}`, body: `${row!.reference} · requested by ${requester.name}`, link: "/admin/finance?tab=approvals" },
    ).catch(() => undefined);
  }
  return row!;
}

/** Cancelling a confirmed booking: a credit note for what was charged minus the cancellation charge, for Finance to approve. */
export async function requestCancellationCreditNote(tx: Tx, b: Booking, cancellationCharge: number | null, requester: Person): Promise<FinanceRequest | null> {
  const charged = await chargedForBooking(tx, b.id);
  if (charged <= 0) return null;
  const refundable = r2(Math.max(0, charged - (cancellationCharge ?? 0)));
  if (refundable <= 0) return null;
  const currency = await ledgerCurrency();
  return createFinanceRequest(
    tx,
    {
      kind: "credit_note",
      agencyId: b.agencyId,
      bookingId: b.id,
      amount: refundable,
      reason: `Booking ${b.reference} cancelled after confirmation. Charged ${currency} ${charged.toLocaleString("en-US")}, cancellation charge ${currency} ${(cancellationCharge ?? 0).toLocaleString("en-US")}.`,
      description: `Credit note: cancelled booking ${b.reference}`,
    },
    requester,
  );
}

function defaultDescription(r: FinanceRequest, bookingRef: string | null): string {
  if (r.description) return r.description;
  const label = REQUEST_KIND_LABEL[r.kind];
  return bookingRef ? `${label}: booking ${bookingRef}` : label;
}

/** Approves a request and posts its journal entry. The approver must be a different person from the requester. */
export async function approveFinanceRequest(id: string, approver: Person, note: string | null) {
  const result = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(financeRequests).where(eq(financeRequests.id, id)).for("update").limit(1);
    if (!r) throw notFound("Request not found");
    if (r.status !== "pending") throw conflict(`This request is already ${r.status}`);
    if (r.requestedBy && r.requestedBy === approver.id) throw forbidden("You raised this request. A different finance user must approve it.");
    const entryDate = r.entryDate ? await checkEntryDate(tx, r.entryDate) : undefined;
    const [booking] = r.bookingId ? await tx.select().from(bookings).where(eq(bookings.id, r.bookingId)).limit(1) : [];
    const description = defaultDescription(r, booking?.reference ?? null);
    const amount = Number(r.amount);
    let lines: PostLine[];
    let agencyId = r.agencyId;
    let reversalOfId: string | null = null;

    if (r.kind === "reversal") {
      const [orig] = await tx.select().from(journalEntries).where(eq(journalEntries.id, r.reversalOfEntryId!)).limit(1);
      if (!orig) throw notFound("The entry to reverse no longer exists");
      const [done] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.reversalOfId, orig.id)).limit(1);
      if (done) throw conflict(`${orig.entryNumber} has already been reversed`);
      lines = await reversedLines(tx, orig.id);
      agencyId = orig.agencyId;
      reversalOfId = orig.id;
      if (orig.paymentId) await tx.update(payments).set({ status: "reversed", reviewNote: `Reversed: ${r.reason}` }).where(eq(payments.id, orig.paymentId));
    } else if (r.kind === "opening_balance") {
      lines = await agencyLines(tx, r.agencyId!, await systemAccountId(tx, "opening_balance_equity"), amount, r.agencyOwes, description);
    } else if (r.kind === "refund_payout") {
      await lockAgency(tx, r.agencyId!);
      const balance = await agencyBalance(tx, r.agencyId!);
      if (-balance < amount) throw badRequest(`The agency's credit with us is ${Math.max(0, -balance).toLocaleString("en-US")}, less than this refund. Approve its credit note first.`);
      const bank = await bankAccount(tx, r.accountId);
      lines = await agencyLines(tx, r.agencyId!, bank.id, amount, true, description);
    } else {
      const c = COUNTER_ACCOUNT[r.kind]!;
      lines = await agencyLines(tx, r.agencyId!, await systemAccountId(tx, c.key), amount, c.agencyOwesMore, description);
    }

    const entry = await postEntry(tx, {
      type: r.kind,
      entryDate,
      description: r.kind === "reversal" ? `Reversal: ${r.description || r.reason}` : description,
      agencyId,
      bookingId: r.bookingId,
      requestId: r.id,
      reversalOfId,
      lines,
      createdBy: { id: r.requestedBy, name: r.requestedByName },
      approvedBy: approver,
    });
    const [updated] = await tx
      .update(financeRequests)
      .set({ status: "approved", reviewedBy: approver.id, reviewedByName: approver.name, reviewNote: note, reviewedAt: new Date(), journalEntryId: entry.id })
      .where(eq(financeRequests.id, r.id))
      .returning();
    await logAudit({ action: "finance.request_approved", entityType: "finance_request", entityId: r.id, newValues: { reference: r.reference, entryNumber: entry.entryNumber, note } }, tx);

    // A credit note for a cancelled booking completes the refund on the booking.
    let refundedBooking: Booking | null = null;
    if (r.kind === "credit_note" && booking?.status === "cancelled") {
      refundedBooking = await setBookingStatus(tx, booking, "refunded", { type: "staff", id: approver.id, name: approver.name, email: approver.email }, `Credit note ${entry.entryNumber} approved: ${(await ledgerCurrency())} ${amount.toLocaleString("en-US")} credited to the agency account`);
    }
    return { request: updated!, entry, agencyId, refundedBooking };
  });

  if (result.agencyId) await notifyAgencyOfEntry(result.agencyId, result.entry.type, Number(result.entry.amount), result.entry.description);
  return result;
}

export async function rejectFinanceRequest(id: string, reviewer: Person, note: string) {
  const [r] = await db
    .update(financeRequests)
    .set({ status: "rejected", reviewedBy: reviewer.id, reviewedByName: reviewer.name, reviewNote: note, reviewedAt: new Date() })
    .where(and(eq(financeRequests.id, id), eq(financeRequests.status, "pending")))
    .returning();
  if (!r) throw conflict("This request is no longer pending");
  await logAudit({ action: "finance.request_rejected", entityType: "finance_request", entityId: id, newValues: { reference: r.reference, note } });
  return r;
}

/** Emails the agency that its account changed, with the new balance. */
export async function notifyAgencyOfEntry(agencyId: string, type: keyof typeof ENTRY_TYPE_LABEL, amount: number, description: string) {
  const [agency] = await db.select({ email: agencies.email, name: agencies.authorizedPerson }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  if (!agency) return;
  const currency = await ledgerCurrency();
  const balance = await agencyBalance(db, agencyId);
  const balanceLine = balance > 0 ? `Balance due ${currency} ${balance.toLocaleString("en-US")}` : balance < 0 ? `Credit ${currency} ${(-balance).toLocaleString("en-US")}` : "Account settled";
  await notifyAgency(agencyId, { type: type === "payment" ? "payment_update" : "account_update", title: `${ENTRY_TYPE_LABEL[type]}: ${currency} ${amount.toLocaleString("en-US")}`, body: `${description}. ${balanceLine}.`, link: "/agent/ledger" });
  const balanceText = balance > 0 ? `Your balance due is ${currency} ${balance.toLocaleString("en-US")}.` : balance < 0 ? `You have ${currency} ${(-balance).toLocaleString("en-US")} in credit with us.` : "Your account is fully settled.";
  await queueEmail(
    agency.email,
    mailTemplates.accountUpdate(await getMailBrand(), agency.name, `${ENTRY_TYPE_LABEL[type]}: ${currency} ${amount.toLocaleString("en-US")}`, `${description}. ${balanceText}`, null, frontendUrl("/agent/ledger")),
  );
}
