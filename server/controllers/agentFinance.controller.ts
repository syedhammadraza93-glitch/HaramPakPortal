import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import { agencies, bookings, ledgerAccounts, paymentStatusEnum, payments } from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import type { Actor } from "../services/booking.service";
import { agencyStatement, creditInfo, defaultRange } from "../services/ledger.service";
import { PAYMENT_METHOD_LABEL, answerClarification, createPayment, paymentDetail, sendPaymentAttachment } from "../services/payment.service";
import { badRequest, forbidden, notFound, ok, parse } from "../utils/http";
import { paginationSchema, uuidSchema } from "../utils/validation";
import { paymentSchema } from "./finance.controller";

function agentActor(req: Request): Actor & { agencyId: string } {
  const user = currentUser(req);
  if (user.type !== "agent" || !user.agency) throw forbidden("Agent account required");
  if (user.agency.status !== "active") throw forbidden("Your account is available once your agency is approved.");
  return { type: "agent", id: user.id, name: user.fullName, email: user.email, agencyId: user.agency.id };
}

/** What the agent sees of a payment (never the internal reviewer details beyond the note meant for them). */
function forAgent(p: Awaited<ReturnType<typeof paymentDetail>>) {
  return {
    id: p.id, reference: p.reference, bookingId: p.bookingId, bookingReference: p.bookingReference, method: p.method, methodLabel: p.methodLabel, amount: p.amount,
    currency: p.currency, paidOn: p.paidOn, bankName: p.bankName, transactionRef: p.transactionRef, notes: p.notes, status: p.status,
    reviewNote: ["rejected", "clarification", "reversed"].includes(p.status) ? p.reviewNote : null, reviewedAt: p.reviewedAt, createdAt: p.createdAt, attachments: p.attachments,
  };
}

/** GET /api/agent/finance/summary: balance, credit, bank accounts to pay into, bookings waiting for payment. */
export const mySummary = async (req: Request, res: Response) => {
  const { agencyId } = agentActor(req);
  const [a] = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  const [credit, banks, awaiting] = await Promise.all([
    creditInfo(db, a!),
    db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name, bankDetails: ledgerAccounts.bankDetails }).from(ledgerAccounts).where(and(eq(ledgerAccounts.isBank, true), eq(ledgerAccounts.isActive, true))).orderBy(asc(ledgerAccounts.code)),
    db
      .select({ id: bookings.id, reference: bookings.reference, packageName: bookings.packageName, totalAmount: bookings.totalAmount, currency: bookings.currency, status: bookings.status, holdExpiresAt: bookings.holdExpiresAt })
      .from(bookings)
      .where(and(eq(bookings.agencyId, agencyId), inArray(bookings.status, ["awaiting_payment", "payment_pending_verification"])))
      .orderBy(asc(bookings.holdExpiresAt)),
  ]);
  ok(res, { credit, banks, awaitingPayment: awaiting, methods: Object.entries(PAYMENT_METHOD_LABEL).filter(([v]) => v !== "cash").map(([value, label]) => ({ value, label })) });
};

/** GET /api/agent/finance/statement?from&to */
export const myStatement = async (req: Request, res: Response) => {
  const { agencyId } = agentActor(req);
  const q = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
  const d = await defaultRange();
  const from = q.from ?? d.from;
  const to = q.to ?? d.to;
  if (from > to) throw badRequest("The start date is after the end date");
  ok(res, await agencyStatement(agencyId, from, to));
};

/** GET /api/agent/finance/payments */
export const myPayments = async (req: Request, res: Response) => {
  const { agencyId } = agentActor(req);
  const q = parse(paginationSchema.extend({ status: z.enum(paymentStatusEnum.enumValues).optional() }), req.query);
  const where = and(eq(payments.agencyId, agencyId), q.status ? eq(payments.status, q.status) : undefined);
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(payments).where(where),
    db
      .select({
        id: payments.id, reference: payments.reference, method: payments.method, amount: payments.amount, currency: payments.currency, paidOn: payments.paidOn,
        status: payments.status, transactionRef: payments.transactionRef, createdAt: payments.createdAt,
        bookingReference: sql<string | null>`(select b.reference from bookings b where b.id = "payments"."booking_id")`,
      })
      .from(payments)
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items: items.map((i) => ({ ...i, methodLabel: PAYMENT_METHOD_LABEL[i.method] })), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

/** POST /api/agent/finance/payments (multipart: fields + files[] receipts) */
export const submitMyPayment = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const data = parse(paymentSchema, req.body);
  if (data.method === "cash") throw badRequest("Cash paid at our office is recorded by our finance team", [{ path: "method", message: "Choose another method" }]);
  const p = await createPayment({ ...data, agencyId: actor.agencyId }, (req.files as Express.Multer.File[]) ?? [], actor);
  ok(res, forAgent(await paymentDetail(p.id, actor.agencyId)), "Payment submitted. Our finance team will verify it.", 201);
};

export const getMyPayment = async (req: Request, res: Response) => {
  const { agencyId } = agentActor(req);
  ok(res, forAgent(await paymentDetail(parse(uuidSchema, req.params.id), agencyId)));
};

/** POST /api/agent/finance/payments/:id/reply (multipart: note + optional files) */
export const replyOnPayment = async (req: Request, res: Response) => {
  const actor = agentActor(req);
  const id = parse(uuidSchema, req.params.id);
  const { note } = parse(z.object({ note: z.string().trim().min(3, "Please write a reply").max(2000) }), req.body);
  const [p] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.agencyId, actor.agencyId))).limit(1);
  if (!p) throw notFound("Payment not found");
  await answerClarification(p, actor, note, (req.files as Express.Multer.File[]) ?? []);
  ok(res, forAgent(await paymentDetail(id, actor.agencyId)), "Reply sent to our finance team");
};

export const downloadMyPaymentFile = async (req: Request, res: Response) => {
  const { agencyId } = agentActor(req);
  await sendPaymentAttachment(res, parse(uuidSchema, req.params.id), parse(uuidSchema, req.params.attachmentId), agencyId);
};
