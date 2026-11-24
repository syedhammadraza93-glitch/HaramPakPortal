import { and, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../database/connection";
import {
  bookingAddons, bookingDocuments, bookingMessages, bookingPassengers, bookingPriceLines, bookingStatusEnum, bookings, packageAddons,
  packageDepartures, packages, paxTypeEnum, roomTypeEnum, type Booking,
} from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import {
  BOOKING_STATUS_LABEL, loadBookingDetail, nextBookingReference, notifyOperations, setBookingStatus, type Actor,
} from "../services/booking.service";
import { priceBooking } from "../services/bookingPricing.service";
import { holdSeats, releaseHeldSeats } from "../services/inventory.service";
import { frontendUrl, getMailBrand, queueEmailToPermission } from "../services/mail.service";
import { getCompany, todayInCompanyTz } from "../services/settings.service";
import { removeFile, saveFile, streamFile } from "../services/storage.service";
import { mailTemplates } from "../utils/emails/templates";
import { inspectUpload, safeFileName } from "../utils/files";
import { availableBookingDocs } from "../services/documents/documents.service";
import { badRequest, forbidden, notFound, ok, parse, validationFailed, type FieldError } from "../utils/http";
import { paginationSchema, uuidSchema } from "../utils/validation";

const EDITABLE = ["draft", "information_required"] as const;
const UPLOAD_ALLOWED = ["draft", "submitted", "under_review", "information_required", "confirmed", "processing"] as const;
const CANCELLABLE = ["draft", "submitted", "under_review", "information_required", "quotation_sent", "awaiting_payment", "payment_pending_verification"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optDate = isoDate.or(z.literal("")).nullable().optional().transform((v) => (v ? v : null));
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

function agentActor(req: Request): Actor & { agencyId: string } {
  const user = currentUser(req);
  if (user.type !== "agent" || !user.agency) throw forbidden("Agent account required");
  if (user.agency.status !== "active") throw forbidden("Bookings are available once your agency is approved.");
  return { type: "agent", id: user.id, name: user.fullName, email: user.email, agencyId: user.agency.id };
}

/** Loads a booking that belongs to the agent's own agency (404 otherwise: never reveals other agencies' bookings). */
async function ownBooking(req: Request, id: string): Promise<Booking> {
  const { agencyId } = agentActor(req);
  const [b] = await db.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.agencyId, agencyId))).limit(1);
  if (!b) throw notFound("Booking not found");
  return b;
}

/** What the agent may do in each status. */
function agentActions(b: Booking): string[] {
  const a: string[] = [];
  if ((EDITABLE as readonly string[]).includes(b.status)) a.push("edit");
  if (b.status === "draft") a.push("submit");
  if (b.status === "information_required") a.push("resubmit");
  if ((UPLOAD_ALLOWED as readonly string[]).includes(b.status)) a.push("upload");
  if ((CANCELLABLE as readonly string[]).includes(b.status)) a.push("cancel");
  if (b.status === "quotation_sent") a.push("accept-quotation", "decline-quotation");
  if (b.status !== "draft") a.push("message");
  return a;
}

async function detailForAgent(id: string) {
  const d = await loadBookingDetail(id, true);
  const pkgRow = await db.select().from(packages).where(eq(packages.id, d.packageId)).limit(1);
  const live =
    d.status === "draft" || d.status === "information_required"
      ? await priceBooking({ agencyId: d.agencyId, pkg: pkgRow[0]!, departureId: d.departureId, passengers: d.passengers.map((p) => ({ paxType: p.paxType, roomType: p.roomType })), addons: d.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })) })
      : null;
  const availableAddons = await db.select({ id: packageAddons.id, name: packageAddons.name, description: packageAddons.description, price: packageAddons.price, basis: packageAddons.basis }).from(packageAddons).where(and(eq(packageAddons.packageId, d.packageId), eq(packageAddons.isActive, true)));
  const { stages, ...rest } = d;
  return {
    ...rest,
    stages: stages.map(({ note: _n, ...s }) => s),
    allowedActions: agentActions(d),
    documentsAvailable: availableBookingDocs(d, d.priceLines.some((l) => l.kind === "quotation")),
    statusLabel: BOOKING_STATUS_LABEL[d.status],
    /** Live price while the agent is still editing (frozen in priceLines once submitted). */
    liveQuote: live,
    availableAddons: availableAddons.map((a) => ({ ...a, price: Number(a.price) })),
  };
}

// ================================================================================
// Create, list, view
// ================================================================================
const createSchema = z.object({ packageId: uuidSchema, departureId: uuidSchema.nullable().optional().transform((v) => v ?? null) });

/** POST /api/agent/bookings: starts a draft for a published package (and an open departure for fixed-date packages). */
export const createBooking = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const { packageId, departureId } = parse(createSchema, req.body);
  const today = await todayInCompanyTz();
  const [pkg] = await db.select().from(packages).where(and(eq(packages.id, packageId), eq(packages.status, "published"))).limit(1);
  if (!pkg) throw notFound("This package is not available");
  let dep: typeof packageDepartures.$inferSelect | undefined;
  if (pkg.bookingMode === "fixed_departure") {
    if (!departureId) throw badRequest("Choose a departure date", [{ path: "departureId", message: "Choose a departure date" }]);
    [dep] = await db.select().from(packageDepartures).where(and(eq(packageDepartures.id, departureId), eq(packageDepartures.packageId, packageId))).limit(1);
    if (!dep || dep.status !== "open" || dep.departureDate < today || (dep.bookingDeadline && dep.bookingDeadline < today)) throw badRequest("This departure is not open for booking");
  } else if (departureId) {
    [dep] = await db.select().from(packageDepartures).where(and(eq(packageDepartures.id, departureId), eq(packageDepartures.packageId, packageId))).limit(1);
  }
  const [row] = await db
    .insert(bookings)
    .values({
      agencyId: actor.agencyId, createdBy: actor.id!, packageId, departureId: dep?.id ?? null, vertical: pkg.vertical, packageCode: pkg.code, packageName: pkg.name,
      departureDate: dep?.departureDate ?? null, returnDate: dep?.returnDate ?? null, isQuotation: pkg.bookingMode === "on_request", currency: pkg.currency,
    })
    .returning();
  await logAudit({ action: "booking.draft_created", entityType: "booking", entityId: row!.id, newValues: { packageId, departureId } });
  ok(res, await detailForAgent(row!.id), "Draft booking started. Add the passengers next.", 201);
};

const listSchema = paginationSchema.extend({
  status: z.enum([...bookingStatusEnum.enumValues, "open"]).optional(),
  search: z.string().trim().max(100).optional(),
});

/** GET /api/agent/bookings */
export const listMyBookings = async (req: Request, res: Response) => {
  const { agencyId } = agentActor(req);
  const q = parse(listSchema, req.query);
  const like = q.search ? `%${q.search.replace(/[%_]/g, "")}%` : null;
  const where = and(
    eq(bookings.agencyId, agencyId),
    q.status === "open" ? inArray(bookings.status, ["draft", "submitted", "under_review", "information_required", "quotation_sent", "confirmed", "processing", "documents_issued"]) : q.status ? eq(bookings.status, q.status) : undefined,
    like ? or(ilike(bookings.reference, like), ilike(bookings.packageName, like), ilike(bookings.agentReference, like), sql`exists (select 1 from booking_passengers bp where bp.booking_id = "bookings"."id" and bp.full_name ilike ${like})`) : undefined,
  );
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(bookings).where(where),
    db
      .select({
        id: bookings.id, reference: bookings.reference, packageName: bookings.packageName, packageCode: bookings.packageCode, vertical: bookings.vertical,
        departureDate: bookings.departureDate, status: bookings.status, paxCount: bookings.paxCount, totalAmount: bookings.totalAmount, currency: bookings.currency,
        isQuotation: bookings.isQuotation, agentReference: bookings.agentReference, holdExpiresAt: bookings.holdExpiresAt, createdAt: bookings.createdAt, updatedAt: bookings.updatedAt,
        leadPassenger: sql<string | null>`(select bp.full_name from booking_passengers bp where bp.booking_id = "bookings"."id" order by bp.sort_order limit 1)`,
      })
      .from(bookings)
      .where(where)
      .orderBy(desc(bookings.updatedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

/** GET /api/agent/bookings/:id */
export const getMyBooking = async (req: Request, res: Response) => {
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  ok(res, await detailForAgent(b.id));
};

// ================================================================================
// Passengers (draft / information required)
// ================================================================================
const passengerSchema = z.object({
  id: uuidSchema.optional(),
  fullName: z.string().trim().min(2, "Name as in passport is required").max(150),
  gender: z.enum(["male", "female"]).nullable().optional().transform((v) => v ?? null),
  dateOfBirth: optDate,
  nationality: optText(60),
  passportNumber: z.string().trim().toUpperCase().max(30).regex(/^[A-Z0-9]*$/, "Letters and numbers only").nullable().optional().transform((v) => (v ? v : null)),
  passportIssueDate: optDate,
  passportExpiryDate: optDate,
  paxType: z.enum(paxTypeEnum.enumValues).default("adult"),
  roomType: z.enum(roomTypeEnum.enumValues).nullable().optional().transform((v) => v ?? null),
  phone: optText(30),
  notes: optText(300),
});

const saveSchema = z.object({
  passengers: z.array(passengerSchema).max(200),
  addons: z.array(z.object({ addonId: uuidSchema, quantity: z.coerce.number().int().min(1).max(500) })).max(30).default([]),
  agentReference: optText(60),
  requestedDates: optText(200),
  agentNotes: optText(2000),
});

/** PUT /api/agent/bookings/:id: passengers, add-ons and notes. Passengers keep their ids so documents stay attached. */
export const saveMyBooking = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  if (!(EDITABLE as readonly string[]).includes(b.status)) throw badRequest(`A booking that is ${BOOKING_STATUS_LABEL[b.status].toLowerCase()} cannot be changed`);
  const data = parse(saveSchema, req.body);
  const today = await todayInCompanyTz();

  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: bookingPassengers.id }).from(bookingPassengers).where(eq(bookingPassengers.bookingId, b.id));
    const keepIds = new Set(data.passengers.map((p) => p.id).filter((id): id is string => !!id && existing.some((e) => e.id === id)));
    const removed = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(bookingPassengers).where(inArray(bookingPassengers.id, removed));
    for (const [i, p] of data.passengers.entries()) {
      const { id, ...values } = p;
      if (id && keepIds.has(id)) await tx.update(bookingPassengers).set({ ...values, sortOrder: i }).where(eq(bookingPassengers.id, id));
      else await tx.insert(bookingPassengers).values({ ...values, bookingId: b.id, sortOrder: i });
    }
    await tx.delete(bookingAddons).where(eq(bookingAddons.bookingId, b.id));
    if (data.addons.length) await tx.insert(bookingAddons).values(data.addons.map((a) => ({ ...a, bookingId: b.id })));

    // While information is required the seats stay held: follow passenger-count changes.
    const newCount = data.passengers.length;
    let seatsHeld = b.seatsHeld;
    if (b.status === "information_required" && b.departureId && b.seatsHeld > 0 && newCount !== b.seatsHeld) {
      if (newCount > b.seatsHeld) await holdSeats(tx, b.departureId, newCount - b.seatsHeld, today);
      else await releaseHeldSeats(tx, b.departureId, b.seatsHeld - newCount);
      seatsHeld = newCount;
    }
    await tx
      .update(bookings)
      .set({ paxCount: newCount, seatsHeld, agentReference: data.agentReference, requestedDates: data.requestedDates, agentNotes: data.agentNotes, version: sql`${bookings.version} + 1` })
      .where(eq(bookings.id, b.id));
    await logAudit({ action: "booking.passengers_saved", entityType: "booking", entityId: b.id, newValues: { paxCount: newCount, addons: data.addons }, actor: { id: actor.id!, email: actor.email! } }, tx);
  });
  ok(res, await detailForAgent(b.id), "Saved");
};

/** Everything that must be right before the company can process the booking. */
async function submissionProblems(b: Booking): Promise<FieldError[]> {
  const d = await loadBookingDetail(b.id, true);
  const { passportValidityMonths } = await getCompany();
  const today = await todayInCompanyTz();
  const errors: FieldError[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });

  if (d.passengers.length === 0) add("passengers", "Add at least one passenger");
  if (d.passengers.length < d.package.minPax) add("passengers", `This package needs at least ${d.package.minPax} passengers`);
  if (d.package.maxGroupSize && d.passengers.length > d.package.maxGroupSize) add("passengers", `This package allows at most ${d.package.maxGroupSize} passengers`);
  if (d.package.status !== "published") add("package", "This package is no longer available");
  if (b.isQuotation) {
    if (!b.requestedDates) add("requestedDates", "Tell us your preferred travel dates");
    return errors;
  }

  if (d.departure) {
    if (d.departure.status !== "open" || d.departure.departureDate < today || (d.departure.bookingDeadline && d.departure.bookingDeadline < today)) add("departure", "This departure is no longer open for booking");
  }
  const mustBeValidUntil = (() => {
    const base = new Date(`${d.returnDate ?? d.departureDate ?? today}T00:00:00Z`);
    base.setUTCMonth(base.getUTCMonth() + passportValidityMonths);
    return base.toISOString().slice(0, 10);
  })();

  d.passengers.forEach((p, i) => {
    const who = `Passenger ${i + 1} (${p.fullName})`;
    const path = `passengers.${i}`;
    if (!p.gender) add(`${path}.gender`, `${who}: choose the gender`);
    if (!p.dateOfBirth) add(`${path}.dateOfBirth`, `${who}: date of birth is required`);
    if (!p.nationality) add(`${path}.nationality`, `${who}: nationality is required`);
    if (!p.passportNumber) add(`${path}.passportNumber`, `${who}: passport number is required`);
    if (!p.passportExpiryDate) add(`${path}.passportExpiryDate`, `${who}: passport expiry date is required`);
    else if (passportValidityMonths > 0 && p.passportExpiryDate < mustBeValidUntil) add(`${path}.passportExpiryDate`, `${who}: passport must be valid until at least ${mustBeValidUntil} (${passportValidityMonths} months after return)`);
    else if (d.departureDate && p.passportExpiryDate <= d.departureDate) add(`${path}.passportExpiryDate`, `${who}: passport expires before departure`);
    if (!p.roomType) add(`${path}.roomType`, `${who}: choose the room type`);
    for (const r of d.documentRequirements.filter((r) => r.isRequired && (r.appliesTo === "all" || r.appliesTo === p.paxType))) {
      const has = d.documents.some((doc) => doc.passengerId === p.id && doc.requirementId === r.id && doc.status !== "rejected");
      if (!has) add(`${path}.documents`, `${who}: upload "${r.name}"`);
    }
  });
  return errors;
}

/** POST /api/agent/bookings/:id/submit (draft) and /resubmit (information required) */
export const submitMyBooking = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  const resubmit = b.status === "information_required";
  if (b.status !== "draft" && !resubmit) throw badRequest(`A booking that is ${BOOKING_STATUS_LABEL[b.status].toLowerCase()} cannot be submitted`);
  const problems = await submissionProblems(b);
  if (problems.length) throw validationFailed(problems);

  const [pkg] = await db.select().from(packages).where(eq(packages.id, b.packageId));
  const [passengers, addons] = await Promise.all([
    db.select().from(bookingPassengers).where(eq(bookingPassengers.bookingId, b.id)),
    db.select().from(bookingAddons).where(eq(bookingAddons.bookingId, b.id)),
  ]);
  const quote = b.isQuotation ? null : await priceBooking({ agencyId: b.agencyId, pkg: pkg!, departureId: b.departureId, passengers, addons });
  if (quote?.problems.length) throw validationFailed(quote.problems.map((m) => ({ path: "price", message: m })));

  const { seatHoldHours } = await getCompany();
  const today = await todayInCompanyTz();
  const updated = await db.transaction(async (tx) => {
    // Hold seats (fixed departures) — locks the departure row so the last seat cannot be sold twice.
    let seatsHeld = b.seatsHeld;
    if (b.departureId && !b.isQuotation) {
      const need = passengers.length - b.seatsHeld;
      if (need > 0) await holdSeats(tx, b.departureId, need, today);
      if (need < 0) await releaseHeldSeats(tx, b.departureId, -need);
      seatsHeld = passengers.length;
    }
    if (quote) {
      await tx.delete(bookingPriceLines).where(eq(bookingPriceLines.bookingId, b.id));
      if (quote.lines.length) await tx.insert(bookingPriceLines).values(quote.lines.map((l, i) => ({ ...l, bookingId: b.id, sortOrder: i })));
    }
    const reference = b.reference ?? (await nextBookingReference(tx));
    const priceNote = resubmit && quote && quote.total !== Number(b.totalAmount)
      ? `; price updated from ${b.currency} ${Number(b.totalAmount).toLocaleString("en-US")} to ${b.currency} ${quote.total.toLocaleString("en-US")} (current prices)`
      : "";
    return setBookingStatus(tx, b, "submitted", actor, resubmit ? `Agent updated the booking and resubmitted it${priceNote}` : null, {
      reference,
      paxCount: passengers.length,
      seatsHeld,
      holdExpiresAt: seatsHeld > 0 ? new Date(Date.now() + seatHoldHours * 3_600_000) : null,
      submittedAt: new Date(),
      ...(quote ? { subtotal: quote.subtotal, chargesTotal: quote.chargesTotal, totalAmount: quote.total } : {}),
    });
  });
  await notifyOperations(updated, b.isQuotation ? "New quotation request" : resubmit ? "Booking resubmitted" : "New booking");
  ok(res, await detailForAgent(b.id), b.isQuotation ? `Quotation request ${updated.reference} sent.` : `Booking ${updated.reference} submitted. Seats are held for ${seatHoldHours} hours while our team reviews it.`);
};

/** POST /api/agent/bookings/:id/cancel  { reason } */
export const cancelMyBooking = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  if (!(CANCELLABLE as readonly string[]).includes(b.status)) {
    throw badRequest("A confirmed booking cannot be cancelled here. Send a message to our team to request a cancellation.");
  }
  const { reason } = parse(z.object({ reason: optText(1000) }), req.body);
  const updated = await db.transaction(async (tx) => {
    if (b.departureId && b.seatsHeld > 0) await releaseHeldSeats(tx, b.departureId, b.seatsHeld);
    return setBookingStatus(tx, b, "cancelled", actor, reason ?? "Cancelled by the agent", { seatsHeld: 0, holdExpiresAt: null, cancelledAt: new Date(), cancelReason: reason ?? "Cancelled by the agent" });
  });
  if (b.status !== "draft") await notifyOperations(updated, "Booking cancelled by the agent");
  ok(res, await detailForAgent(b.id), "Booking cancelled");
};

/** POST /api/agent/bookings/:id/quotation/:decision  (accept | decline) */
export const answerQuotation = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  const decision = parse(z.enum(["accept", "decline"]), req.params.decision);
  if (b.status !== "quotation_sent") throw badRequest("There is no quotation waiting for your answer");
  const today = await todayInCompanyTz();
  if (decision === "accept" && b.quoteValidUntil && b.quoteValidUntil < today) throw badRequest("This quotation has expired. Send a message to ask for a new one.");
  const updated = await db.transaction((tx) =>
    decision === "accept"
      ? setBookingStatus(tx, b, "under_review", actor, "Quotation accepted by the agent")
      : setBookingStatus(tx, b, "cancelled", actor, "Quotation declined by the agent", { cancelledAt: new Date(), cancelReason: "Quotation declined" }),
  );
  await notifyOperations(updated, decision === "accept" ? "Quotation accepted" : "Quotation declined");
  ok(res, await detailForAgent(b.id), decision === "accept" ? "Quotation accepted. Our team will confirm the booking." : "Quotation declined");
};

// ================================================================================
// Documents and messages
// ================================================================================
const docSchema = z.object({
  passengerId: uuidSchema.optional(),
  requirementId: uuidSchema.optional(),
  name: z.string().trim().min(2).max(150).optional(),
});

/** POST /api/agent/bookings/:id/documents (multipart: file, passengerId?, requirementId? or name) */
export const uploadMyDocument = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  if (!(UPLOAD_ALLOWED as readonly string[]).includes(b.status)) throw badRequest("Documents cannot be added to this booking any more");
  const body = parse(docSchema, req.body);
  if (!req.file) throw badRequest("Choose a file");
  if (body.passengerId) {
    const [p] = await db.select({ id: bookingPassengers.id }).from(bookingPassengers).where(and(eq(bookingPassengers.id, body.passengerId), eq(bookingPassengers.bookingId, b.id)));
    if (!p) throw badRequest("Passenger not found on this booking");
  }
  const d = await loadBookingDetail(b.id, true);
  const requirement = body.requirementId ? d.documentRequirements.find((r) => r.id === body.requirementId) : null;
  if (body.requirementId && !requirement) throw badRequest("Unknown document type for this booking");
  const name = requirement?.name ?? body.name;
  if (!name) throw badRequest("Say what the document is", [{ path: "name", message: "Document name is required" }]);

  const info = inspectUpload(req.file);
  const id = randomUUID();
  const key = `bookings/${b.id}/${id}.${info.ext}`;
  await saveFile(key, req.file.buffer);
  try {
    await db.insert(bookingDocuments).values({
      id, bookingId: b.id, passengerId: body.passengerId ?? null, requirementId: requirement?.id ?? null, name, storageKey: key,
      fileName: safeFileName(req.file.originalname), mimeType: info.mime, sizeBytes: req.file.size, uploadedBy: actor.id, uploadedByType: "agent",
    });
  } catch (e) {
    await removeFile(key).catch(() => undefined);
    throw e;
  }
  await logAudit({ action: "booking.document_uploaded", entityType: "booking", entityId: b.id, newValues: { name, fileName: req.file.originalname } });
  ok(res, await detailForAgent(b.id), "Document uploaded", 201);
};

/** DELETE /api/agent/bookings/:id/documents/:documentId: only the agent's own, unverified uploads while still editable. */
export const deleteMyDocument = async (req: Request, res: Response) => {
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  const docId = parse(uuidSchema, req.params.documentId);
  if (!(EDITABLE as readonly string[]).includes(b.status)) throw badRequest("Documents cannot be removed now. Upload a new version instead.");
  const [doc] = await db
    .delete(bookingDocuments)
    .where(and(eq(bookingDocuments.id, docId), eq(bookingDocuments.bookingId, b.id), eq(bookingDocuments.uploadedByType, "agent"), ne(bookingDocuments.status, "verified")))
    .returning();
  if (!doc) throw notFound("Document not found or already verified");
  await removeFile(doc.storageKey).catch(() => undefined);
  ok(res, await detailForAgent(b.id), "Document removed");
};

/** Streams a booking document after the caller checked access. */
export async function sendBookingDocument(res: Response, bookingId: string, documentId: string, extra?: SQL) {
  const [doc] = await db.select().from(bookingDocuments).where(and(eq(bookingDocuments.id, documentId), eq(bookingDocuments.bookingId, bookingId), extra)).limit(1);
  if (!doc) throw notFound("Document not found");
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  const stream = streamFile(doc.storageKey);
  stream.on("error", () => (res.headersSent ? res.end() : res.status(404).json({ success: false, message: "File is missing" })));
  stream.pipe(res);
}

export const downloadMyDocument = async (req: Request, res: Response) => {
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  await sendBookingDocument(res, b.id, parse(uuidSchema, req.params.documentId));
};

/** POST /api/agent/bookings/:id/messages  { message } */
export const postMyMessage = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const b = await ownBooking(req, parse(uuidSchema, req.params.id));
  if (b.status === "draft") throw badRequest("Submit the booking first, then you can message our team");
  const { message } = parse(z.object({ message: z.string().trim().min(1, "Write a message").max(4000) }), req.body);
  await db.insert(bookingMessages).values({ bookingId: b.id, authorType: "agent", authorId: actor.id, authorName: actor.name, message });
  await queueEmailToPermission("booking.manage", mailTemplates.bookingMessage(await getMailBrand(), b.reference ?? "", actor.name, message, frontendUrl(`/admin/bookings/${b.id}`)), { type: "message", title: `Message from ${actor.name} on ${b.reference ?? "a booking"}`, body: message.slice(0, 300), link: `/admin/bookings/${b.id}` });
  ok(res, await detailForAgent(b.id), "Message sent", 201);
};

/** GET /api/agent/bookings/summary: counts for the dashboard. */
export const myBookingSummary = async (req: Request, res: Response) => {
  const { agencyId } = agentActor(req);
  const rows = await db.select({ status: bookings.status, n: count() }).from(bookings).where(eq(bookings.agencyId, agencyId)).groupBy(bookings.status);
  ok(res, Object.fromEntries(rows.map((r) => [r.status, r.n])));
};

