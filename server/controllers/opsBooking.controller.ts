import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../database/connection";
import {
  agencies, bookingDocuments, bookingMessages, bookingPriceLines, bookingStageProgress, bookingStages, bookingStatusEnum, bookings, verticalEnum,
  type Booking, type BookingStatus,
} from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import {
  BOOKING_STATUS_LABEL, FINAL_STATUSES, cancellationChargeFor, loadBookingDetail, notifyAgent, setBookingStatus, type Actor,
} from "../services/booking.service";
import { confirmSeats, releaseHeldSeats, releaseSoldSeats } from "../services/inventory.service";
import { frontendUrl, getMailBrand, queueEmail } from "../services/mail.service";
import { todayInCompanyTz } from "../services/settings.service";
import { removeFile, saveFile } from "../services/storage.service";
import { mailTemplates } from "../utils/emails/templates";
import { inspectUpload, safeFileName } from "../utils/files";
import { availableBookingDocs } from "../services/documents/documents.service";
import { AppError, badRequest, forbidden, notFound, ok, parse } from "../utils/http";
import { requestCancellationCreditNote } from "../services/financeRequest.service";
import { notifyAgency } from "../services/notification.service";
import { checkCredit, creditInfo, lockAgency, postBookingCharge } from "../services/ledger.service";
import { paginationSchema, uuidSchema } from "../utils/validation";
import { sendBookingDocument } from "./agentBooking.controller";

function staffActor(req: Request): Actor {
  const u = currentUser(req);
  return { type: "staff", id: u.id, name: u.fullName, email: u.email };
}

async function loadBooking(id: string): Promise<Booking> {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (!b) throw notFound("Booking not found");
  return b;
}

interface Rule {
  from: BookingStatus[];
  to: BookingStatus;
  reasonRequired: boolean;
  label: string;
}

/**
 * Operations workflow. Confirming charges the agency (ledger debit) after a credit check; "Ask for payment" sends the
 * booking to the agent to pay first. Cancelling a confirmed booking raises a credit note for Finance to approve.
 */
export const OPS_ACTIONS: Record<string, Rule> = {
  review: { from: ["submitted"], to: "under_review", reasonRequired: false, label: "Start review" },
  "request-info": { from: ["submitted", "under_review"], to: "information_required", reasonRequired: true, label: "Request information" },
  "await-payment": { from: ["submitted", "under_review"], to: "awaiting_payment", reasonRequired: false, label: "Ask for payment" },
  confirm: { from: ["submitted", "under_review", "awaiting_payment", "payment_pending_verification"], to: "confirmed", reasonRequired: false, label: "Confirm booking" },
  reject: { from: ["submitted", "under_review", "information_required", "awaiting_payment", "payment_pending_verification"], to: "rejected", reasonRequired: true, label: "Reject" },
  process: { from: ["confirmed"], to: "processing", reasonRequired: false, label: "Start processing" },
  "issue-documents": { from: ["processing"], to: "documents_issued", reasonRequired: false, label: "Documents issued" },
  complete: { from: ["confirmed", "processing", "documents_issued"], to: "completed", reasonRequired: false, label: "Mark completed" },
  cancel: { from: ["submitted", "under_review", "information_required", "quotation_sent", "awaiting_payment", "payment_pending_verification", "confirmed", "processing", "documents_issued"], to: "cancelled", reasonRequired: true, label: "Cancel booking" },
};

function staffActions(b: Booking, hasQuotationLines: boolean): string[] {
  const actions = Object.entries(OPS_ACTIONS)
    .filter(([, r]) => r.from.includes(b.status))
    .map(([k]) => k)
    // A quotation request can be confirmed only after the agent accepted a quotation.
    .filter((k) => !((k === "confirm" || k === "await-payment") && b.isQuotation && !hasQuotationLines));
  if (b.isQuotation && ["submitted", "under_review"].includes(b.status)) actions.push("send-quotation");
  return actions;
}

// ================================================================================
// Queue and detail
// ================================================================================
const listSchema = paginationSchema.extend({
  status: z.enum([...bookingStatusEnum.enumValues, "queue", "active"]).optional(),
  vertical: z.enum(verticalEnum.enumValues).optional(),
  agencyId: uuidSchema.optional(),
  departureId: uuidSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

const QUEUE: BookingStatus[] = ["submitted", "under_review", "information_required", "quotation_sent"];
const ACTIVE: BookingStatus[] = ["confirmed", "processing", "documents_issued"];

/** GET /api/admin/bookings (drafts are the agent's private work and are not listed) */
export const listBookings = async (req: Request, res: Response) => {
  const q = parse(listSchema, req.query);
  const like = q.search ? `%${q.search.replace(/[%_]/g, "")}%` : null;
  const where = and(
    sql`${bookings.status} <> 'draft'`,
    q.status === "queue" ? inArray(bookings.status, QUEUE) : q.status === "active" ? inArray(bookings.status, ACTIVE) : q.status ? eq(bookings.status, q.status) : undefined,
    q.vertical ? eq(bookings.vertical, q.vertical) : undefined,
    q.agencyId ? eq(bookings.agencyId, q.agencyId) : undefined,
    q.departureId ? eq(bookings.departureId, q.departureId) : undefined,
    like
      ? or(ilike(bookings.reference, like), ilike(bookings.packageName, like), ilike(agencies.agencyName, like), ilike(agencies.agentCode, like), sql`exists (select 1 from booking_passengers bp where bp.booking_id = ${bookings.id} and (bp.full_name ilike ${like} or bp.passport_number ilike ${like}))`)
      : undefined,
  );
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(bookings).innerJoin(agencies, eq(agencies.id, bookings.agencyId)).where(where),
    db
      .select({
        id: bookings.id, reference: bookings.reference, packageName: bookings.packageName, packageCode: bookings.packageCode, vertical: bookings.vertical,
        departureDate: bookings.departureDate, status: bookings.status, paxCount: bookings.paxCount, totalAmount: bookings.totalAmount, currency: bookings.currency,
        isQuotation: bookings.isQuotation, holdExpiresAt: bookings.holdExpiresAt, submittedAt: bookings.submittedAt, updatedAt: bookings.updatedAt,
        agencyName: agencies.agencyName, agentCode: agencies.agentCode,
        leadPassenger: sql<string | null>`(select bp.full_name from booking_passengers bp where bp.booking_id = ${bookings.id} order by bp.sort_order limit 1)`,
        pendingDocuments: sql<number>`(select count(*)::int from booking_documents bd where bd.booking_id = ${bookings.id} and bd.status = 'pending' and not bd.issued)`,
      })
      .from(bookings)
      .innerJoin(agencies, eq(agencies.id, bookings.agencyId))
      .where(where)
      .orderBy(q.status === "queue" ? asc(bookings.submittedAt) : desc(bookings.updatedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

/** GET /api/admin/bookings/summary: counts by status (dashboard). */
export const bookingSummary = async (_req: Request, res: Response) => {
  const rows = await db.select({ status: bookings.status, n: count() }).from(bookings).where(sql`${bookings.status} <> 'draft'`).groupBy(bookings.status);
  ok(res, Object.fromEntries(rows.map((r) => [r.status, r.n])));
};

async function staffDetail(id: string, req: Request) {
  const d = await loadBookingDetail(id, false);
  const canManage = currentUser(req).permissions.includes("booking.manage");
  const hasQuote = d.priceLines.some((l) => l.kind === "quotation");
  const user = currentUser(req);
  let credit = null;
  if (OPS_ACTIONS.confirm!.from.includes(d.status)) {
    const [agency] = await db.select().from(agencies).where(eq(agencies.id, d.agencyId)).limit(1);
    const info = await creditInfo(db, agency!);
    credit = { ...info, check: checkCredit(info, Number(d.totalAmount)), canOverride: user.permissions.includes("finance.manage") };
  }
  return {
    ...d,
    credit,
    statusLabel: BOOKING_STATUS_LABEL[d.status],
    documentsAvailable: availableBookingDocs(d, hasQuote),
    allowedActions: canManage ? staffActions(d, hasQuote) : [],
    actionRules: Object.fromEntries(Object.entries(OPS_ACTIONS).map(([k, r]) => [k, { label: r.label, reasonRequired: r.reasonRequired }])),
    canManage,
  };
}

export const getBooking = async (req: Request, res: Response) => {
  ok(res, await staffDetail(parse(uuidSchema, req.params.id), req));
};

// ================================================================================
// Status changes
// ================================================================================

/** POST /api/admin/bookings/:id/status/:action  { reason } */
export const changeBookingStatus = async (req: Request, res: Response) => {
  const actor = staffActor(req);
  const id = parse(uuidSchema, req.params.id);
  const action = String(req.params.action);
  const rule = OPS_ACTIONS[action];
  if (!rule) throw notFound("Unknown action");
  const { reason, overrideCredit } = parse(z.object({ reason: z.string().trim().max(2000).optional().default(""), overrideCredit: z.boolean().optional().default(false) }), req.body);
  const b = await loadBooking(id);
  if (!rule.from.includes(b.status)) throw badRequest(`A booking that is ${BOOKING_STATUS_LABEL[b.status].toLowerCase()} cannot be changed with "${rule.label}"`);
  if (rule.reasonRequired && reason.length < 3) throw badRequest("A reason is required", [{ path: "reason", message: "Please enter a reason (at least 3 characters)" }]);
  if (action === "confirm" && b.isQuotation) {
    const [q] = await db.select({ n: count() }).from(bookingPriceLines).where(and(eq(bookingPriceLines.bookingId, id), eq(bookingPriceLines.kind, "quotation")));
    if (!q?.n) throw badRequest("Send a quotation and wait for the agent to accept it before confirming.");
  }
  const today = await todayInCompanyTz();
  const charge = action === "cancel" && ["confirmed", "processing", "documents_issued"].includes(b.status) ? await cancellationChargeFor(b, today) : null;

  const user = currentUser(req);
  if (overrideCredit && !user.permissions.includes("finance.manage")) throw forbidden("Only Finance can confirm over the credit limit");
  let historyReason = reason || null;
  let creditRequest: Awaited<ReturnType<typeof requestCancellationCreditNote>> = null;

  const updated = await db.transaction(async (tx) => {
    let extra: Partial<typeof bookings.$inferInsert> = {};
    if (action === "confirm") {
      // Credit control: the agency row is locked so two confirmations cannot use the same credit.
      const agency = await lockAgency(tx, b.agencyId);
      const check = checkCredit(await creditInfo(tx, agency), Number(b.totalAmount));
      if (!check.withinCredit) {
        const short = `${b.currency} ${check.shortBy.toLocaleString("en-US")}`;
        if (check.policy === "block" && !overrideCredit) {
          throw new AppError(409, `This booking is ${short} over the agency's available ${agency.paymentTerms === "credit" ? "credit" : "balance"}. Ask the agent for payment, or Finance can confirm with an override.`, undefined, "CREDIT_LIMIT");
        }
        if (overrideCredit && reason.trim().length < 5) throw badRequest("Give the reason for the credit override", [{ path: "reason", message: "At least 5 characters" }]);
        historyReason = overrideCredit ? `Credit override (${short} over): ${reason}` : [`Over the available credit by ${short} (warning only)`, reason].filter(Boolean).join(". ");
        await logAudit({ action: overrideCredit ? "finance.credit_override" : "finance.credit_warning", entityType: "booking", entityId: b.id, newValues: { shortBy: check.shortBy, available: check.available, amount: check.amount, reason } }, tx);
      }
      if (b.departureId && !b.isQuotation) await confirmSeats(tx, b.departureId, b.seatsHeld, b.paxCount);
      extra = { seatsHeld: 0, seatsSold: b.departureId && !b.isQuotation ? b.paxCount : 0, holdExpiresAt: null, confirmedAt: new Date() };
      const confirmed = await setBookingStatus(tx, b, rule.to, actor, historyReason, extra);
      await postBookingCharge(tx, confirmed, actor);
      return confirmed;
    }
    if (action === "reject" || action === "cancel") {
      if (b.departureId && b.seatsHeld > 0) await releaseHeldSeats(tx, b.departureId, b.seatsHeld);
      if (b.departureId && b.seatsSold > 0) await releaseSoldSeats(tx, b.departureId, b.seatsSold);
      extra = { seatsHeld: 0, seatsSold: 0, holdExpiresAt: null, ...(action === "cancel" ? { cancelledAt: new Date(), cancelReason: reason, cancellationCharge: charge } : {}) };
    }
    const row = await setBookingStatus(tx, b, rule.to, actor, historyReason, extra);
    if (action === "cancel") creditRequest = await requestCancellationCreditNote(tx, row, charge, actor);
    return row;
  });
  const agentReason = action === "cancel" && charge ? `${reason}\nCancellation charge under the package policy: ${updated.currency} ${charge.toLocaleString("en-US")}` : reason || null;
  const credited = creditRequest as { amount: number; reference: string } | null;
  await notifyAgent(updated, credited ? `${agentReason ?? ""}\nA credit note of ${updated.currency} ${Number(credited.amount).toLocaleString("en-US")} will be added to your account once our finance team approves it.`.trim() : agentReason);
  ok(res, await staffDetail(id, req), credited ? `${rule.label}: done. Credit note ${credited.reference} sent to Finance for approval.` : `${rule.label}: done`);
};

const quotationSchema = z.object({
  lines: z.array(z.object({ description: z.string().trim().min(2).max(250), quantity: z.coerce.number().int().min(1).max(500).default(1), unitAmount: z.coerce.number().min(0).max(100_000_000) })).min(1, "Add at least one line"),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"),
  message: z.string().trim().max(2000).optional().default(""),
});

/** POST /api/admin/bookings/:id/quotation: price for an on-request booking; the agent then accepts or declines. */
export const sendQuotation = async (req: Request, res: Response) => {
  const actor = staffActor(req);
  const id = parse(uuidSchema, req.params.id);
  const data = parse(quotationSchema, req.body);
  const b = await loadBooking(id);
  if (!b.isQuotation || !["submitted", "under_review"].includes(b.status)) throw badRequest("A quotation can only be sent for a submitted quotation request");
  if (data.validUntil < (await todayInCompanyTz())) throw badRequest("The validity date is in the past", [{ path: "validUntil", message: "Choose a future date" }]);
  const lines = data.lines.map((l, i) => ({ bookingId: id, kind: "quotation" as const, description: l.description, quantity: l.quantity, unitAmount: Math.round(l.unitAmount), amount: Math.round(l.unitAmount) * l.quantity, sortOrder: i }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const updated = await db.transaction(async (tx) => {
    await tx.delete(bookingPriceLines).where(eq(bookingPriceLines.bookingId, id));
    await tx.insert(bookingPriceLines).values(lines);
    if (data.message) await tx.insert(bookingMessages).values({ bookingId: id, authorType: "staff", authorId: actor.id, authorName: actor.name, message: data.message });
    return setBookingStatus(tx, b, "quotation_sent", actor, data.message || null, { subtotal: total, chargesTotal: 0, totalAmount: total, quoteValidUntil: data.validUntil });
  });
  await notifyAgent(updated, `Quotation total: ${updated.currency} ${total.toLocaleString("en-US")}, valid until ${data.validUntil}. Open the booking to accept or decline.`);
  ok(res, await staffDetail(id, req), "Quotation sent to the agent");
};

// ================================================================================
// Documents, messages, stages
// ================================================================================

/** PATCH /api/admin/bookings/:id/documents/:documentId  { status: verified | rejected | pending, note } */
export const reviewDocument = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const docId = parse(uuidSchema, req.params.documentId);
  const { status, note } = parse(z.object({ status: z.enum(["pending", "verified", "rejected"]), note: z.string().trim().max(300).optional().nullable() }), req.body);
  if (status === "rejected" && !note) throw badRequest("Say why the document is rejected", [{ path: "note", message: "A note is required when rejecting" }]);
  const [doc] = await db.update(bookingDocuments).set({ status, reviewNote: note ?? null }).where(and(eq(bookingDocuments.id, docId), eq(bookingDocuments.bookingId, id), eq(bookingDocuments.issued, false))).returning();
  if (!doc) throw notFound("Document not found");
  await logAudit({ action: `booking.document_${status}`, entityType: "booking", entityId: id, newValues: { document: doc.name, note } });
  if (status === "rejected") {
    const [bk] = await db.select({ agencyId: bookings.agencyId, reference: bookings.reference }).from(bookings).where(eq(bookings.id, id)).limit(1);
    if (bk) await notifyAgency(bk.agencyId, { type: "document_issue", title: `Document rejected on booking ${bk.reference ?? ""}: ${doc.name}`, body: note ?? null, link: `/agent/bookings/${id}` });
  }
  ok(res, await staffDetail(id, req), status === "verified" ? "Document verified" : status === "rejected" ? "Document rejected" : "Document reset");
};

/** POST /api/admin/bookings/:id/documents (multipart: file, name, passengerId?): travel documents for the agent (vouchers, visas, tickets). */
export const issueDocument = async (req: Request, res: Response) => {
  const actor = staffActor(req);
  const id = parse(uuidSchema, req.params.id);
  const b = await loadBooking(id);
  if (!["confirmed", "processing", "documents_issued", "completed"].includes(b.status)) throw badRequest("Travel documents can be added once the booking is confirmed");
  const body = parse(z.object({ name: z.string().trim().min(2, "Name the document").max(150), passengerId: uuidSchema.optional() }), req.body);
  if (!req.file) throw badRequest("Choose a file");
  const info = inspectUpload(req.file);
  const docId = randomUUID();
  const key = `bookings/${id}/issued-${docId}.${info.ext}`;
  await saveFile(key, req.file.buffer);
  try {
    await db.insert(bookingDocuments).values({
      id: docId, bookingId: id, passengerId: body.passengerId ?? null, name: body.name, issued: true, storageKey: key, fileName: safeFileName(req.file.originalname),
      mimeType: info.mime, sizeBytes: req.file.size, status: "verified", uploadedBy: actor.id, uploadedByType: "staff",
    });
  } catch (e) {
    await removeFile(key).catch(() => undefined);
    throw e;
  }
  await logAudit({ action: "booking.document_issued", entityType: "booking", entityId: id, newValues: { name: body.name } });
  ok(res, await staffDetail(id, req), "Document added for the agent", 201);
};

export const downloadDocument = async (req: Request, res: Response) => {
  await sendBookingDocument(res, parse(uuidSchema, req.params.id), parse(uuidSchema, req.params.documentId));
};

/** POST /api/admin/bookings/:id/messages  { message, isInternal } */
export const postMessage = async (req: Request, res: Response) => {
  const actor = staffActor(req);
  const id = parse(uuidSchema, req.params.id);
  const { message, isInternal } = parse(z.object({ message: z.string().trim().min(1, "Write a message").max(4000), isInternal: z.boolean().default(false) }), req.body);
  const b = await loadBooking(id);
  await db.insert(bookingMessages).values({ bookingId: id, authorType: "staff", authorId: actor.id, authorName: actor.name, message, isInternal });
  if (!isInternal) {
    const [agency] = await db.select({ email: agencies.email }).from(agencies).where(eq(agencies.id, b.agencyId));
    await notifyAgency(b.agencyId, { type: "message", title: `New message on booking ${b.reference ?? ""}`, body: message.slice(0, 300), link: `/agent/bookings/${id}` });
    if (agency) await queueEmail(agency.email, mailTemplates.bookingMessage(await getMailBrand(), b.reference ?? "", (await getMailBrand()).name, message, frontendUrl(`/agent/bookings/${id}`)));
  }
  ok(res, await staffDetail(id, req), isInternal ? "Internal note added" : "Message sent to the agent", 201);
};

/** PUT /api/admin/bookings/:id/stages/:stageId  { done, note } */
export const setStage = async (req: Request, res: Response) => {
  const actor = staffActor(req);
  const id = parse(uuidSchema, req.params.id);
  const stageId = parse(uuidSchema, req.params.stageId);
  const { done, note } = parse(z.object({ done: z.boolean(), note: z.string().trim().max(300).optional().nullable() }), req.body);
  const b = await loadBooking(id);
  if (FINAL_STATUSES.includes(b.status) && b.status !== "completed") throw forbidden("This booking is closed");
  const [stage] = await db.select().from(bookingStages).where(and(eq(bookingStages.id, stageId), eq(bookingStages.vertical, b.vertical)));
  if (!stage) throw notFound("Stage not found for this product type");
  if (done) {
    await db
      .insert(bookingStageProgress)
      .values({ bookingId: id, stageId, completedBy: actor.id, completedByName: actor.name, note: note ?? null })
      .onConflictDoUpdate({ target: [bookingStageProgress.bookingId, bookingStageProgress.stageId], set: { note: note ?? null, completedBy: actor.id, completedByName: actor.name, completedAt: new Date() } });
  } else {
    await db.delete(bookingStageProgress).where(and(eq(bookingStageProgress.bookingId, id), eq(bookingStageProgress.stageId, stageId)));
  }
  await logAudit({ action: done ? "booking.stage_done" : "booking.stage_undone", entityType: "booking", entityId: id, newValues: { stage: stage.name, note } });
  ok(res, await staffDetail(id, req), done ? `${stage.name}: done` : `${stage.name}: reopened`);
};
