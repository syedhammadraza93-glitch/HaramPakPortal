import { and, asc, eq, sql } from "drizzle-orm";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "../database/connection";
import { agencies, bookings, ledgerAccounts, paymentAttachments, payments, type Booking, type Payment } from "../database/schema";
import { mailTemplates } from "../utils/emails/templates";
import { inspectUpload, safeFileName } from "../utils/files";
import { badRequest, conflict, forbidden, notFound } from "../utils/http";
import { logAudit } from "./audit.service";
import { notifyAgent, notifyOperations, setBookingStatus, type Actor } from "./booking.service";
import { notifyAgencyOfEntry } from "./financeRequest.service";
import { agencyLines, checkEntryDate, ledgerCurrency, nextNumber, postEntry, type Person } from "./ledger.service";
import { frontendUrl, getMailBrand, queueEmail, queueEmailToPermission } from "./mail.service";
import { removeFile, saveFile, streamFile } from "./storage.service";
import { notifyAgency } from "./notification.service";

export const PAYMENT_METHOD_LABEL: Record<Payment["method"], string> = {
  bank_transfer: "Bank transfer",
  cash_deposit: "Cash deposit",
  cheque: "Cheque",
  cash: "Cash at office",
  online: "Online payment",
  other: "Other",
};

export interface NewPayment {
  agencyId: string;
  bookingId?: string | null;
  method: Payment["method"];
  amount: number;
  paidOn: string;
  bankAccountId?: string | null;
  transactionRef?: string | null;
  notes?: string | null;
}

async function activeBank(client: Tx | typeof db, id: string | null | undefined, required: boolean) {
  if (!id) {
    if (required) throw badRequest("Choose the bank account the money was paid into", [{ path: "bankAccountId", message: "Required" }]);
    return null;
  }
  const [acc] = await client.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.isBank, true), eq(ledgerAccounts.isActive, true))).limit(1);
  if (!acc) throw badRequest("Choose one of the listed bank accounts", [{ path: "bankAccountId", message: "Unknown bank account" }]);
  return acc;
}

/** Saves receipt files; returns rows to insert. Files are removed again if the database insert fails. */
async function storeReceipts(paymentId: string, files: Express.Multer.File[]) {
  const rows: (typeof paymentAttachments.$inferInsert)[] = [];
  for (const file of files) {
    const info = inspectUpload(file);
    const key = `payments/${paymentId}/${randomUUID()}.${info.ext}`;
    await saveFile(key, file.buffer);
    rows.push({ paymentId, storageKey: key, fileName: safeFileName(file.originalname), mimeType: info.mime, sizeBytes: file.size });
  }
  return rows;
}

/** A payment reported by an agent or recorded by Finance. It reaches the ledger only when verified. */
export async function createPayment(input: NewPayment, files: Express.Multer.File[], actor: Actor & { agencyName?: string }): Promise<Payment> {
  const currency = await ledgerCurrency();
  const today = await checkEntryDate(db, null);
  if (input.paidOn > today) throw badRequest("The payment date cannot be in the future", [{ path: "paidOn", message: "Use today or an earlier date" }]);
  const needsReceipt = actor.type === "agent" && ["bank_transfer", "cash_deposit", "cheque"].includes(input.method);
  if (needsReceipt && files.length === 0) throw badRequest("Attach the deposit slip or transfer receipt", [{ path: "files", message: "A receipt is required" }]);
  await activeBank(db, input.bankAccountId, ["bank_transfer", "cash_deposit", "cheque"].includes(input.method) && actor.type === "agent");

  let booking: Booking | undefined;
  if (input.bookingId) {
    [booking] = await db.select().from(bookings).where(and(eq(bookings.id, input.bookingId), eq(bookings.agencyId, input.agencyId))).limit(1);
    if (!booking) throw badRequest("Booking not found for this agency", [{ path: "bookingId", message: "Unknown booking" }]);
  }

  const id = randomUUID();
  const receiptRows = await storeReceipts(id, files);
  let result: { payment: Payment; booking: Booking | null };
  try {
    result = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(payments)
        .values({
          id,
          reference: await nextNumber(tx, "PAY"),
          agencyId: input.agencyId,
          bookingId: input.bookingId ?? null,
          method: input.method,
          amount: Math.round(input.amount * 100) / 100,
          currency,
          paidOn: input.paidOn,
          bankAccountId: input.bankAccountId ?? null,
          transactionRef: input.transactionRef ?? null,
          notes: input.notes ?? null,
          submittedBy: actor.id,
          submittedByName: actor.name,
          submittedByType: actor.type,
        })
        .returning();
      if (receiptRows.length) await tx.insert(paymentAttachments).values(receiptRows);
      await logAudit({ action: "payment.submitted", entityType: "payment", entityId: id, newValues: { reference: p!.reference, amount: p!.amount, method: p!.method, bookingId: p!.bookingId } }, tx);
      // A booking waiting for payment moves on so Operations can see the payment is in.
      const moved = booking?.status === "awaiting_payment" ? await setBookingStatus(tx, booking, "payment_pending_verification", actor, `Payment ${p!.reference} submitted: ${currency} ${p!.amount.toLocaleString("en-US")}`) : null;
      return { payment: p!, booking: moved };
    });
  } catch (e) {
    await Promise.all(receiptRows.map((r) => removeFile(r.storageKey).catch(() => undefined)));
    throw e;
  }

  const { payment } = result;
  const [agency] = await db.select({ name: agencies.agencyName, code: agencies.agentCode }).from(agencies).where(eq(agencies.id, input.agencyId)).limit(1);
  await queueEmailToPermission(
    "finance.manage",
    mailTemplates.financeForStaff(
      await getMailBrand(),
      `Payment to verify: ${payment.reference}`,
      [`${agency?.name ?? ""}${agency?.code ? ` (${agency.code})` : ""}`, `${PAYMENT_METHOD_LABEL[payment.method]}: ${currency} ${payment.amount.toLocaleString("en-US")} on ${payment.paidOn}`, booking ? `For booking ${booking.reference}` : "On account"],
      frontendUrl(`/admin/finance/payments/${payment.id}`),
    ),
    { type: "payment", title: `Payment to verify: ${currency} ${payment.amount.toLocaleString("en-US")}`, body: `${payment.reference} · ${agency?.name ?? ""}`, link: `/admin/finance/payments/${payment.id}` },
  ).catch(() => undefined);
  return payment;
}

async function lockPayment(tx: Tx, id: string): Promise<Payment> {
  const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update").limit(1);
  if (!p) throw notFound("Payment not found");
  return p;
}

async function emailAgency(p: Payment, heading: string, message: string, note: string | null) {
  const [agency] = await db.select({ email: agencies.email, name: agencies.authorizedPerson }).from(agencies).where(eq(agencies.id, p.agencyId)).limit(1);
  await notifyAgency(p.agencyId, { type: "payment_update", title: heading, body: note ? `${message} ${note}` : message, link: "/agent/ledger" });
  if (agency) await queueEmail(agency.email, mailTemplates.accountUpdate(await getMailBrand(), agency.name, heading, message, note, frontendUrl("/agent/ledger")));
}

/** Finance verifies a payment: the bank is debited and the agency credited. */
export async function verifyPayment(id: string, reviewer: Person, opts: { bankAccountId?: string | null; entryDate?: string | null; note?: string | null }) {
  const result = await db.transaction(async (tx) => {
    const p = await lockPayment(tx, id);
    if (!["pending", "clarification"].includes(p.status)) throw conflict(`This payment is already ${p.status}`);
    if (p.submittedByType === "staff" && p.submittedBy === reviewer.id) throw forbidden("You recorded this payment. A different finance user must verify it.");
    const bank = await activeBank(tx, opts.bankAccountId ?? p.bankAccountId, true);
    const entryDate = await checkEntryDate(tx, opts.entryDate || null);
    const [booking] = p.bookingId ? await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).limit(1) : [];
    const description = `Payment ${p.reference}${booking ? ` for booking ${booking.reference}` : ""}${p.transactionRef ? ` · ref ${p.transactionRef}` : ""}`;
    const entry = await postEntry(tx, {
      type: "payment",
      entryDate,
      description,
      agencyId: p.agencyId,
      bookingId: p.bookingId,
      paymentId: p.id,
      lines: await agencyLines(tx, p.agencyId, bank!.id, Number(p.amount), false, description),
      createdBy: { id: p.submittedBy, name: p.submittedByName ?? "Agent" },
      approvedBy: reviewer,
    });
    const [updated] = await tx
      .update(payments)
      .set({ status: "verified", bankAccountId: bank!.id, reviewedBy: reviewer.id, reviewedByName: reviewer.name, reviewedAt: new Date(), reviewNote: opts.note ?? null, journalEntryId: entry.id })
      .where(eq(payments.id, p.id))
      .returning();
    await logAudit({ action: "payment.verified", entityType: "payment", entityId: p.id, newValues: { reference: p.reference, entryNumber: entry.entryNumber, note: opts.note } }, tx);
    const moved =
      booking?.status === "payment_pending_verification"
        ? await setBookingStatus(tx, booking, "under_review", { type: "staff", id: reviewer.id, name: reviewer.name, email: reviewer.email }, `Payment ${p.reference} verified. Ready to confirm.`)
        : null;
    return { payment: updated!, entry, booking: moved };
  });
  await notifyAgencyOfEntry(result.payment.agencyId, "payment", Number(result.payment.amount), result.entry.description);
  if (result.booking) await notifyOperations(result.booking, "Payment verified: ready to confirm");
  return result.payment;
}

/** Finance rejects a payment (not received, wrong amount…) or asks the agent for more information. */
export async function reviewPayment(id: string, reviewer: Person, to: "rejected" | "clarification", note: string) {
  const result = await db.transaction(async (tx) => {
    const p = await lockPayment(tx, id);
    if (!["pending", "clarification"].includes(p.status)) throw conflict(`This payment is already ${p.status}`);
    const [updated] = await tx
      .update(payments)
      .set({ status: to, reviewedBy: reviewer.id, reviewedByName: reviewer.name, reviewedAt: new Date(), reviewNote: note })
      .where(eq(payments.id, p.id))
      .returning();
    await logAudit({ action: `payment.${to}`, entityType: "payment", entityId: p.id, newValues: { reference: p.reference, note } }, tx);
    const [booking] = p.bookingId ? await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).limit(1) : [];
    const moved =
      to === "rejected" && booking?.status === "payment_pending_verification"
        ? await setBookingStatus(tx, booking, "awaiting_payment", { type: "staff", id: reviewer.id, name: reviewer.name, email: reviewer.email }, `Payment ${p.reference} was not accepted: ${note}`)
        : null;
    return { payment: updated!, booking: moved };
  });
  const p = result.payment;
  const currency = p.currency;
  await emailAgency(
    p,
    to === "rejected" ? `Payment ${p.reference} not accepted` : `Payment ${p.reference}: more information needed`,
    to === "rejected"
      ? `We could not accept your payment of ${currency} ${Number(p.amount).toLocaleString("en-US")}.`
      : `Please check your payment of ${currency} ${Number(p.amount).toLocaleString("en-US")} and reply from the portal.`,
    note,
  );
  if (result.booking) await notifyAgent(result.booking, `Payment ${p.reference} was not accepted: ${note}`);
  return p;
}

/** The agent answers a clarification request: a note and optionally more receipts; the payment goes back to Finance. */
export async function answerClarification(p: Payment, actor: Actor, note: string, files: Express.Multer.File[]) {
  if (p.status !== "clarification") throw badRequest("This payment is not waiting for your reply");
  const receiptRows = await storeReceipts(p.id, files);
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(payments)
        .set({ status: "pending", notes: [p.notes, `Reply (${new Date().toISOString().slice(0, 10)}): ${note}`].filter(Boolean).join("\n") })
        .where(and(eq(payments.id, p.id), eq(payments.status, "clarification")))
        .returning();
      if (!row) throw conflict("This payment was changed meanwhile. Please reload.");
      if (receiptRows.length) await tx.insert(paymentAttachments).values(receiptRows);
      await logAudit({ action: "payment.clarified", entityType: "payment", entityId: p.id, newValues: { note, files: receiptRows.length } }, tx);
    });
  } catch (e) {
    await Promise.all(receiptRows.map((r) => removeFile(r.storageKey).catch(() => undefined)));
    throw e;
  }
  await queueEmailToPermission(
    "finance.manage",
    mailTemplates.financeForStaff(await getMailBrand(), `Agent replied on payment ${p.reference}`, [`From ${actor.name}`, note], frontendUrl(`/admin/finance/payments/${p.id}`)),
    { type: "payment", title: `Agent replied on payment ${p.reference}`, body: note.slice(0, 300), link: `/admin/finance/payments/${p.id}` },
  ).catch(() => undefined);
}

const sqlEntryNumber = sql<string | null>`(select e.entry_number from journal_entries e where e.id = ${payments.journalEntryId})`;

export async function paymentDetail(id: string, agencyId?: string) {
  const [row] = await db
    .select({
      payment: payments,
      agencyName: agencies.agencyName,
      agentCode: agencies.agentCode,
      bookingReference: bookings.reference,
      bankName: ledgerAccounts.name,
      entryNumber: sqlEntryNumber,
    })
    .from(payments)
    .innerJoin(agencies, eq(agencies.id, payments.agencyId))
    .leftJoin(bookings, eq(bookings.id, payments.bookingId))
    .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, payments.bankAccountId))
    .where(and(eq(payments.id, id), agencyId ? eq(payments.agencyId, agencyId) : undefined))
    .limit(1);
  if (!row) throw notFound("Payment not found");
  const attachments = await db
    .select({ id: paymentAttachments.id, fileName: paymentAttachments.fileName, mimeType: paymentAttachments.mimeType, sizeBytes: paymentAttachments.sizeBytes, createdAt: paymentAttachments.createdAt })
    .from(paymentAttachments)
    .where(eq(paymentAttachments.paymentId, id))
    .orderBy(asc(paymentAttachments.createdAt));
  const { payment, ...rest } = row;
  return { ...payment, ...rest, methodLabel: PAYMENT_METHOD_LABEL[payment.method], attachments };
}

/** Streams a receipt. Pass agencyId to restrict to one agency (agent portal). */
export async function sendPaymentAttachment(res: Response, paymentId: string, attachmentId: string, agencyId?: string) {
  const [att] = await db
    .select({ a: paymentAttachments })
    .from(paymentAttachments)
    .innerJoin(payments, eq(payments.id, paymentAttachments.paymentId))
    .where(and(eq(paymentAttachments.id, attachmentId), eq(paymentAttachments.paymentId, paymentId), agencyId ? eq(payments.agencyId, agencyId) : undefined))
    .limit(1);
  if (!att) throw notFound("File not found");
  res.setHeader("Content-Type", att.a.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${att.a.fileName.replace(/"/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  streamFile(att.a.storageKey).on("error", () => res.destroy()).pipe(res);
}
