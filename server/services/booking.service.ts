import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, type Tx } from "../database/connection";
import {
  agencies, bookingAddons, bookingDocuments, bookingMessages, bookingPassengers, bookingPriceLines, bookingStageProgress, bookingStages,
  bookingStatusHistory, bookings, cancellationSlabs, counters, documentRequirements, packageAddons, packageDepartures, packages,
  type Booking, type BookingStatus,
} from "../database/schema";
import { mailTemplates } from "../utils/emails/templates";
import { conflict, notFound } from "../utils/http";
import { logAudit } from "./audit.service";
import { frontendUrl, getMailBrand, queueEmail, queueEmailToPermission } from "./mail.service";
import { releaseHeldSeats, seatsLeftOf } from "./inventory.service";
import { notifyAgency } from "./notification.service";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  information_required: "Information required",
  quotation_sent: "Quotation sent",
  awaiting_payment: "Awaiting payment",
  payment_pending_verification: "Payment pending verification",
  confirmed: "Confirmed",
  processing: "Processing",
  documents_issued: "Documents issued",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
  refunded: "Refunded",
};

/**
 * Statuses where the hold can expire. A booking whose payment is being verified keeps its seats until Finance decides,
 * so the agent never loses seats they have already paid for.
 */
export const HOLDING_STATUSES: BookingStatus[] = ["submitted", "under_review", "information_required", "awaiting_payment"];
export const FINAL_STATUSES: BookingStatus[] = ["completed", "cancelled", "rejected", "refunded"];

export interface Actor {
  type: "staff" | "agent" | "system";
  id: string | null;
  name: string;
  email?: string;
}

export async function nextBookingReference(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const [c] = await tx
    .insert(counters)
    .values({ name: `booking_${year}`, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `BKG-${year}-${String(c!.value).padStart(6, "0")}`;
}

/** Changes the status only if nobody changed it meanwhile, and records history + audit. */
export async function setBookingStatus(
  tx: Tx,
  booking: Booking,
  to: BookingStatus,
  actor: Actor,
  reason: string | null,
  extra: Partial<typeof bookings.$inferInsert> = {},
): Promise<Booking> {
  const [row] = await tx
    .update(bookings)
    .set({ status: to, ...extra, version: sql`${bookings.version} + 1` })
    .where(and(eq(bookings.id, booking.id), eq(bookings.status, booking.status)))
    .returning();
  if (!row) throw conflict("This booking was changed by someone else. Please reload.");
  await tx.insert(bookingStatusHistory).values({ bookingId: booking.id, fromStatus: booking.status, toStatus: to, reason, actorType: actor.type, changedBy: actor.id, changedByName: actor.name });
  await logAudit(
    { action: `booking.${to}`, entityType: "booking", entityId: booking.id, oldValues: { status: booking.status }, newValues: { status: to, reason, ...extra }, actor: actor.id && actor.email ? { id: actor.id, email: actor.email } : actor.type === "system" ? null : undefined },
    tx,
  );
  return row;
}

/** Emails the agency about a status change (after the transaction committed). */
export async function notifyAgent(booking: Booking, reason: string | null) {
  const [agency] = await db.select({ email: agencies.email, name: agencies.authorizedPerson }).from(agencies).where(eq(agencies.id, booking.agencyId));
  if (!agency) return;
  await notifyAgency(booking.agencyId, {
    type: ["cancelled", "rejected", "refunded"].includes(booking.status) ? "cancellation" : "booking_update",
    title: `Booking ${booking.reference ?? booking.packageName}: ${BOOKING_STATUS_LABEL[booking.status]}`,
    body: reason,
    link: `/agent/bookings/${booking.id}`,
  });
  await queueEmail(
    agency.email,
    mailTemplates.bookingUpdate(await getMailBrand(), agency.name, booking.reference ?? booking.packageName, BOOKING_STATUS_LABEL[booking.status], reason, frontendUrl(`/agent/bookings/${booking.id}`)),
  );
}

export async function notifyOperations(booking: Booking, headline: string) {
  const [agency] = await db.select({ name: agencies.agencyName, code: agencies.agentCode }).from(agencies).where(eq(agencies.id, booking.agencyId));
  await queueEmailToPermission(
    "booking.manage",
    mailTemplates.bookingForOperations(await getMailBrand(), headline, booking.reference ?? "", `${agency?.name ?? ""}${agency?.code ? ` (${agency.code})` : ""}`, booking.packageName, frontendUrl(`/admin/bookings/${booking.id}`)),
    { type: "booking", title: `${headline}: ${booking.reference ?? ""}`, body: `${agency?.name ?? ""} · ${booking.packageName}`, link: `/admin/bookings/${booking.id}` },
  );
}

/** Cancellation charge under the package's policy: the slab with the fewest days that still covers the days left. */
export async function cancellationChargeFor(booking: Booking, today: string): Promise<number | null> {
  if (!booking.departureDate) return null;
  const [pkg] = await db.select({ policyId: packages.cancellationPolicyId }).from(packages).where(eq(packages.id, booking.packageId));
  if (!pkg?.policyId) return null;
  const slabs = await db.select().from(cancellationSlabs).where(eq(cancellationSlabs.policyId, pkg.policyId)).orderBy(asc(cancellationSlabs.daysBefore));
  const daysLeft = Math.round((Date.parse(booking.departureDate) - Date.parse(today)) / 86_400_000);
  const slab = slabs.find((s) => daysLeft <= s.daysBefore);
  if (!slab) return 0;
  const total = Number(booking.totalAmount);
  return Math.round(slab.chargeType === "percent" ? (total * Number(slab.chargeValue)) / 100 : Math.min(total, Number(slab.chargeValue)));
}

/** Full booking for the booking pages. Agents never see internal messages. */
export async function loadBookingDetail(id: string, forAgent: boolean) {
  const [row] = await db
    .select({ booking: bookings, agencyName: agencies.agencyName, agentCode: agencies.agentCode, agencyEmail: agencies.email, agencyPhone: agencies.phone })
    .from(bookings)
    .innerJoin(agencies, eq(agencies.id, bookings.agencyId))
    .where(eq(bookings.id, id))
    .limit(1);
  if (!row) throw notFound("Booking not found");
  const b = row.booking;

  const [passengers, addons, lines, documents, history, messages, pkgRows, departure, stages, progress, requirements] = await Promise.all([
    db.select().from(bookingPassengers).where(eq(bookingPassengers.bookingId, id)).orderBy(asc(bookingPassengers.sortOrder)),
    db
      .select({ addonId: bookingAddons.addonId, quantity: bookingAddons.quantity, name: packageAddons.name, price: packageAddons.price, basis: packageAddons.basis })
      .from(bookingAddons)
      .innerJoin(packageAddons, eq(packageAddons.id, bookingAddons.addonId))
      .where(eq(bookingAddons.bookingId, id)),
    db.select().from(bookingPriceLines).where(eq(bookingPriceLines.bookingId, id)).orderBy(asc(bookingPriceLines.sortOrder)),
    db
      .select({ id: bookingDocuments.id, passengerId: bookingDocuments.passengerId, requirementId: bookingDocuments.requirementId, name: bookingDocuments.name, issued: bookingDocuments.issued, fileName: bookingDocuments.fileName, mimeType: bookingDocuments.mimeType, sizeBytes: bookingDocuments.sizeBytes, status: bookingDocuments.status, reviewNote: bookingDocuments.reviewNote, uploadedByType: bookingDocuments.uploadedByType, createdAt: bookingDocuments.createdAt })
      .from(bookingDocuments)
      .where(eq(bookingDocuments.bookingId, id))
      .orderBy(asc(bookingDocuments.createdAt)),
    db.select().from(bookingStatusHistory).where(eq(bookingStatusHistory.bookingId, id)).orderBy(desc(bookingStatusHistory.createdAt)),
    db
      .select()
      .from(bookingMessages)
      .where(and(eq(bookingMessages.bookingId, id), forAgent ? eq(bookingMessages.isInternal, false) : undefined))
      .orderBy(asc(bookingMessages.createdAt)),
    db.select().from(packages).where(eq(packages.id, b.packageId)).limit(1),
    b.departureId ? db.select().from(packageDepartures).where(eq(packageDepartures.id, b.departureId)).limit(1) : Promise.resolve([]),
    db.select().from(bookingStages).where(and(eq(bookingStages.vertical, b.vertical), eq(bookingStages.isActive, true))).orderBy(asc(bookingStages.sortOrder)),
    db.select().from(bookingStageProgress).where(eq(bookingStageProgress.bookingId, id)),
    db
      .select()
      .from(documentRequirements)
      .where(and(eq(documentRequirements.vertical, b.vertical), eq(documentRequirements.isActive, true), or(isNull(documentRequirements.packageId), eq(documentRequirements.packageId, b.packageId))))
      .orderBy(asc(documentRequirements.sortOrder)),
  ]);
  const pkg = pkgRows[0]!;
  const dep = departure[0];
  return {
    ...b,
    agency: { id: b.agencyId, name: row.agencyName, agentCode: row.agentCode, email: row.agencyEmail, phone: row.agencyPhone },
    package: { id: pkg.id, code: pkg.code, name: pkg.name, bookingMode: pkg.bookingMode, minPax: pkg.minPax, maxGroupSize: pkg.maxGroupSize, status: pkg.status },
    departure: dep ? { id: dep.id, departureDate: dep.departureDate, returnDate: dep.returnDate, bookingDeadline: dep.bookingDeadline, seatsLeft: seatsLeftOf(dep), status: dep.status } : null,
    passengers,
    addons: addons.map((a) => ({ ...a, price: Number(a.price) })),
    priceLines: lines,
    documents,
    history,
    messages,
    documentRequirements: requirements.map((r) => ({ id: r.id, name: r.name, description: r.description, isRequired: r.isRequired, appliesTo: r.appliesTo })),
    stages: stages.map((s) => {
      const p = progress.find((x) => x.stageId === s.id);
      return { id: s.id, name: s.name, description: s.description, done: !!p, completedAt: p?.completedAt ?? null, completedByName: p?.completedByName ?? null, note: p?.note ?? null };
    }),
  };
}

/**
 * Releases seats of bookings whose hold expired without confirmation, and cancels those bookings.
 * Runs every minute from index.ts.
 */
export async function expireSeatHolds(): Promise<number> {
  const due = await db
    .select()
    .from(bookings)
    .where(and(inArray(bookings.status, HOLDING_STATUSES), gt(bookings.seatsHeld, 0), isNotNull(bookings.holdExpiresAt), lt(bookings.holdExpiresAt, new Date())))
    .limit(50);
  let expired = 0;
  for (const b of due) {
    try {
      const updated = await db.transaction(async (tx) => {
        if (b.departureId) await releaseHeldSeats(tx, b.departureId, b.seatsHeld);
        return setBookingStatus(tx, b, "cancelled", { type: "system", id: null, name: "System" }, "Seat hold expired before the booking was confirmed", {
          seatsHeld: 0, holdExpiresAt: null, cancelledAt: new Date(), cancelReason: "Seat hold expired",
        });
      });
      expired++;
      await notifyAgent(updated, "The seats were held for the agreed time, but the booking was not confirmed. Please submit a new booking if you still need these seats.");
    } catch (e: any) {
      console.error(`[bookings] could not expire hold of ${b.reference}:`, e?.message || e);
    }
  }
  return expired;
}

export function startBookingJobs(): void {
  setInterval(() => void expireSeatHolds().catch((e) => console.error("[bookings] hold expiry failed:", e?.message || e)), 60_000).unref();
}
