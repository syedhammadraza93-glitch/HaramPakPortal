import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../database/connection";
import {
  accountingPeriods, agencies, bookingCosts, bookings, financeRequestKindEnum, financeRequestStatusEnum, financeRequests, journalEntries, journalLines,
  ledgerAccounts, paymentMethodEnum, paymentStatusEnum, payments, suppliers, entryTypeEnum,
} from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { logAudit } from "../services/audit.service";
import type { Actor } from "../services/booking.service";
import { REQUEST_KIND_LABEL, approveFinanceRequest, createFinanceRequest, rejectFinanceRequest } from "../services/financeRequest.service";
import {
  ENTRY_TYPE_LABEL, agencyStatement, chargedForBooking, checkCredit, creditInfo, defaultRange, ledgerCurrency, r2, systemAccountId, type Person,
} from "../services/ledger.service";
import { PAYMENT_METHOD_LABEL, createPayment, paymentDetail, reviewPayment, sendPaymentAttachment, verifyPayment } from "../services/payment.service";
import { todayInCompanyTz } from "../services/settings.service";
import { badRequest, conflict, notFound, ok, parse } from "../utils/http";
import { paginationSchema, uuidSchema } from "../utils/validation";

function staff(req: Request): Person & Actor {
  const u = currentUser(req);
  return { type: "staff", id: u.id, name: u.fullName, email: u.email };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optDate = isoDate.optional().nullable().or(z.literal("").transform(() => null));
const money = z.coerce.number().positive("Must be more than 0").max(1_000_000_000);
const note = (min: number, label = "a note") => z.string().trim().min(min, `Please enter ${label} (at least ${min} characters)`).max(2000);
const optNote = z.string().trim().max(2000).optional().nullable().transform((v) => v || null);
const pageOf = <T>(items: T[], page: number, pageSize: number) => ({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize });

// ================================================================================
// Overview and agency balances
// ================================================================================
async function agencyBalances() {
  const recv = await systemAccountId(db, "agency_receivable");
  const rows = await db
    .select({
      id: agencies.id,
      agencyName: agencies.agencyName,
      agentCode: agencies.agentCode,
      city: agencies.city,
      status: agencies.status,
      paymentTerms: agencies.paymentTerms,
      creditLimit: agencies.creditLimit,
      creditPolicy: agencies.creditPolicy,
      paymentTermsDays: agencies.paymentTermsDays,
      balance: sql<string>`coalesce((select sum(l.debit - l.credit) from journal_lines l where l.account_id = ${recv} and l.agency_id = "agencies"."id"), 0)`,
      lastPayment: sql<string | null>`(select max(e.entry_date) from journal_entries e where e.agency_id = "agencies"."id" and e.type = 'payment')`,
      pendingPayments: sql<number>`(select count(*)::int from payments p where p.agency_id = "agencies"."id" and p.status in ('pending', 'clarification'))`,
    })
    .from(agencies)
    .where(sql`${agencies.agentCode} is not null`)
    .orderBy(asc(agencies.agencyName));
  return rows.map((r) => {
    const balance = r2(Number(r.balance));
    const creditLimit = Number(r.creditLimit);
    const available = r2(r.paymentTerms === "credit" ? creditLimit - balance : -balance);
    return { ...r, balance, creditLimit, available, overLimit: r.paymentTerms === "credit" ? balance > creditLimit : balance > 0 };
  });
}

/** GET /api/admin/finance/summary */
export const financeSummary = async (_req: Request, res: Response) => {
  const balances = await agencyBalances();
  const [[pendingPay], [pendingReq], recent] = await Promise.all([
    db.select({ n: count(), total: sql<string>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(inArray(payments.status, ["pending", "clarification"])),
    db.select({ n: count() }).from(financeRequests).where(eq(financeRequests.status, "pending")),
    db
      .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber, entryDate: journalEntries.entryDate, type: journalEntries.type, description: journalEntries.description, amount: journalEntries.amount, agencyName: agencies.agencyName })
      .from(journalEntries)
      .leftJoin(agencies, eq(agencies.id, journalEntries.agencyId))
      .orderBy(desc(journalEntries.createdAt))
      .limit(8),
  ]);
  ok(res, {
    currency: await ledgerCurrency(),
    receivable: r2(balances.reduce((s, b) => s + Math.max(0, b.balance), 0)),
    agencyCredit: r2(balances.reduce((s, b) => s + Math.max(0, -b.balance), 0)),
    agenciesOwing: balances.filter((b) => b.balance > 0).length,
    overLimit: balances.filter((b) => b.overLimit).length,
    pendingPayments: pendingPay?.n ?? 0,
    pendingPaymentsAmount: r2(Number(pendingPay?.total ?? 0)),
    pendingRequests: pendingReq?.n ?? 0,
    recent: recent.map((e) => ({ ...e, typeLabel: ENTRY_TYPE_LABEL[e.type] })),
  });
};

/** GET /api/admin/finance/agencies?search&filter=all|owing|credit|over_limit */
export const listAgencyBalances = async (req: Request, res: Response) => {
  const q = parse(paginationSchema.extend({ search: z.string().trim().max(100).optional(), filter: z.enum(["all", "owing", "credit", "over_limit"]).default("all") }), req.query);
  const s = q.search?.toLowerCase();
  const items = (await agencyBalances()).filter(
    (b) =>
      (!s || b.agencyName.toLowerCase().includes(s) || (b.agentCode ?? "").toLowerCase().includes(s) || b.city.toLowerCase().includes(s)) &&
      (q.filter === "all" || (q.filter === "owing" && b.balance > 0) || (q.filter === "credit" && b.balance < 0) || (q.filter === "over_limit" && b.overLimit)),
  );
  ok(res, pageOf(items, q.page, q.pageSize));
};

async function loadAgency(id: string) {
  const [a] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1);
  if (!a) throw notFound("Agency not found");
  return a;
}

/** GET /api/admin/finance/agencies/:id: credit position, pending payments and requests. */
export const getAgencyFinance = async (req: Request, res: Response) => {
  const a = await loadAgency(parse(uuidSchema, req.params.id));
  const [credit, pendingPayments, requests] = await Promise.all([
    creditInfo(db, a),
    db.select().from(payments).where(and(eq(payments.agencyId, a.id), inArray(payments.status, ["pending", "clarification"]))).orderBy(desc(payments.createdAt)),
    db.select().from(financeRequests).where(and(eq(financeRequests.agencyId, a.id), eq(financeRequests.status, "pending"))).orderBy(desc(financeRequests.createdAt)),
  ]);
  ok(res, {
    agency: { id: a.id, agencyName: a.agencyName, agentCode: a.agentCode, city: a.city, status: a.status, email: a.email, phone: a.phone },
    credit,
    pendingPayments,
    pendingRequests: requests.map((r) => ({ ...r, kindLabel: REQUEST_KIND_LABEL[r.kind] })),
  });
};

const creditSchema = z.object({
  paymentTerms: z.enum(["advance", "credit"]),
  creditLimit: z.coerce.number().min(0).max(1_000_000_000),
  creditPolicy: z.enum(["warn", "block"]),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
});

/** PUT /api/admin/finance/agencies/:id/credit */
export const updateAgencyCredit = async (req: Request, res: Response) => {
  const a = await loadAgency(parse(uuidSchema, req.params.id));
  const data = parse(creditSchema, req.body);
  if (data.paymentTerms === "advance") data.creditLimit = 0;
  await db.update(agencies).set(data).where(eq(agencies.id, a.id));
  await logAudit({
    action: "finance.credit_terms_changed",
    entityType: "agency",
    entityId: a.id,
    oldValues: { paymentTerms: a.paymentTerms, creditLimit: a.creditLimit, creditPolicy: a.creditPolicy, paymentTermsDays: a.paymentTermsDays },
    newValues: data,
  });
  ok(res, await creditInfo(db, { ...a, ...data }), "Credit terms saved");
};

const rangeSchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/** GET /api/admin/finance/agencies/:id/statement?from&to */
export const agencyStatementForStaff = async (req: Request, res: Response) => {
  const a = await loadAgency(parse(uuidSchema, req.params.id));
  const q = parse(rangeSchema, req.query);
  const d = await defaultRange();
  const from = q.from ?? d.from;
  const to = q.to ?? d.to;
  if (from > to) throw badRequest("The start date is after the end date");
  ok(res, { agency: { id: a.id, agencyName: a.agencyName, agentCode: a.agentCode }, ...(await agencyStatement(a.id, from, to)) });
};

// ================================================================================
// Payments
// ================================================================================
const paymentListSchema = paginationSchema.extend({
  status: z.enum([...paymentStatusEnum.enumValues, "open"]).optional(),
  agencyId: uuidSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

/** GET /api/admin/finance/payments */
export const listPayments = async (req: Request, res: Response) => {
  const q = parse(paymentListSchema, req.query);
  const like = q.search ? `%${q.search.replace(/[%_]/g, "")}%` : null;
  const where = and(
    q.status === "open" ? inArray(payments.status, ["pending", "clarification"]) : q.status ? eq(payments.status, q.status) : undefined,
    q.agencyId ? eq(payments.agencyId, q.agencyId) : undefined,
    like ? or(ilike(payments.reference, like), ilike(payments.transactionRef, like), ilike(agencies.agencyName, like), ilike(agencies.agentCode, like)) : undefined,
  );
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(payments).innerJoin(agencies, eq(agencies.id, payments.agencyId)).where(where),
    db
      .select({
        id: payments.id, reference: payments.reference, method: payments.method, amount: payments.amount, currency: payments.currency, paidOn: payments.paidOn,
        status: payments.status, transactionRef: payments.transactionRef, createdAt: payments.createdAt, submittedByType: payments.submittedByType,
        agencyId: payments.agencyId, agencyName: agencies.agencyName, agentCode: agencies.agentCode,
        bookingReference: sql<string | null>`(select b.reference from bookings b where b.id = ${payments.bookingId})`,
        bankName: sql<string | null>`(select a.name from ledger_accounts a where a.id = ${payments.bankAccountId})`,
        files: sql<number>`(select count(*)::int from payment_attachments f where f.payment_id = ${payments.id})`,
      })
      .from(payments)
      .innerJoin(agencies, eq(agencies.id, payments.agencyId))
      .where(where)
      .orderBy(q.status === "open" || q.status === "pending" ? asc(payments.createdAt) : desc(payments.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items: items.map((i) => ({ ...i, methodLabel: PAYMENT_METHOD_LABEL[i.method] })), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

export const getPayment = async (req: Request, res: Response) => {
  const p = await paymentDetail(parse(uuidSchema, req.params.id));
  const user = currentUser(req);
  ok(res, { ...p, canVerify: user.permissions.includes("finance.manage") && ["pending", "clarification"].includes(p.status) && !(p.submittedByType === "staff" && p.submittedBy === user.id) });
};

export const paymentSchema = z.object({
  bookingId: uuidSchema.optional().nullable().or(z.literal("").transform(() => null)),
  method: z.enum(paymentMethodEnum.enumValues),
  amount: money,
  paidOn: isoDate,
  bankAccountId: uuidSchema.optional().nullable().or(z.literal("").transform(() => null)),
  transactionRef: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  notes: optNote,
});

/** POST /api/admin/finance/payments (multipart): Finance records money received (e.g. cash at the office). Another user verifies it. */
export const recordPayment = async (req: Request, res: Response) => {
  const data = parse(paymentSchema.extend({ agencyId: uuidSchema }), req.body);
  await loadAgency(data.agencyId);
  const p = await createPayment(data, (req.files as Express.Multer.File[]) ?? [], staff(req));
  ok(res, await paymentDetail(p.id), "Payment recorded. Another finance user must verify it.", 201);
};

/** POST /api/admin/finance/payments/:id/verify { bankAccountId?, entryDate?, note? } */
export const verifyPaymentHandler = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const body = parse(z.object({ bankAccountId: uuidSchema.optional().nullable(), entryDate: optDate, note: optNote }), req.body);
  await verifyPayment(id, staff(req), body);
  ok(res, await paymentDetail(id), "Payment verified and posted to the agency account");
};

/** POST /api/admin/finance/payments/:id/reject | /clarify { note } */
export const reviewPaymentHandler = (to: "rejected" | "clarification") => async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const { note: text } = parse(z.object({ note: note(3, to === "rejected" ? "the reason" : "your question") }), req.body);
  await reviewPayment(id, staff(req), to, text);
  ok(res, await paymentDetail(id), to === "rejected" ? "Payment rejected" : "Question sent to the agent");
};

export const downloadPaymentAttachment = async (req: Request, res: Response) => {
  await sendPaymentAttachment(res, parse(uuidSchema, req.params.id), parse(uuidSchema, req.params.attachmentId));
};

// ================================================================================
// Finance requests (maker-checker)
// ================================================================================
const requestListSchema = paginationSchema.extend({
  status: z.enum(financeRequestStatusEnum.enumValues).optional(),
  kind: z.enum(financeRequestKindEnum.enumValues).optional(),
  agencyId: uuidSchema.optional(),
});

/** GET /api/admin/finance/requests */
export const listRequests = async (req: Request, res: Response) => {
  const q = parse(requestListSchema, req.query);
  const where = and(
    q.status ? eq(financeRequests.status, q.status) : undefined,
    q.kind ? eq(financeRequests.kind, q.kind) : undefined,
    q.agencyId ? eq(financeRequests.agencyId, q.agencyId) : undefined,
  );
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(financeRequests).where(where),
    db
      .select({
        r: financeRequests,
        agencyName: agencies.agencyName,
        agentCode: agencies.agentCode,
        bookingReference: sql<string | null>`(select b.reference from bookings b where b.id = ${financeRequests.bookingId})`,
        accountName: sql<string | null>`(select a.name from ledger_accounts a where a.id = ${financeRequests.accountId})`,
        reversalOfNumber: sql<string | null>`(select e.entry_number from journal_entries e where e.id = ${financeRequests.reversalOfEntryId})`,
        entryNumber: sql<string | null>`(select e.entry_number from journal_entries e where e.id = ${financeRequests.journalEntryId})`,
      })
      .from(financeRequests)
      .leftJoin(agencies, eq(agencies.id, financeRequests.agencyId))
      .where(where)
      .orderBy(q.status === "pending" ? asc(financeRequests.createdAt) : desc(financeRequests.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  const me = currentUser(req);
  ok(res, {
    items: items.map(({ r, ...rest }) => ({ ...r, ...rest, kindLabel: REQUEST_KIND_LABEL[r.kind], canApprove: r.status === "pending" && me.permissions.includes("finance.approve") && r.requestedBy !== me.id })),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  });
};

const newRequestSchema = z.object({
  kind: z.enum(financeRequestKindEnum.enumValues),
  agencyId: uuidSchema.optional().nullable(),
  bookingId: uuidSchema.optional().nullable().or(z.literal("").transform(() => null)),
  amount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  agencyOwes: z.boolean().optional(),
  accountId: uuidSchema.optional().nullable().or(z.literal("").transform(() => null)),
  reversalOfEntryId: uuidSchema.optional().nullable(),
  entryDate: optDate,
  reason: note(5, "the reason"),
  description: z.string().trim().max(200).optional().nullable(),
});

/** POST /api/admin/finance/requests */
export const createRequest = async (req: Request, res: Response) => {
  const data = parse(newRequestSchema, req.body);
  const r = await db.transaction((tx) => createFinanceRequest(tx, data, staff(req)));
  ok(res, { ...r, kindLabel: REQUEST_KIND_LABEL[r.kind] }, "Request sent for approval", 201);
};

/** POST /api/admin/finance/requests/:id/approve { note? } */
export const approveRequest = async (req: Request, res: Response) => {
  const { note: n } = parse(z.object({ note: optNote }), req.body);
  const { entry } = await approveFinanceRequest(parse(uuidSchema, req.params.id), staff(req), n);
  ok(res, { entryId: entry.id, entryNumber: entry.entryNumber }, `Approved and posted as ${entry.entryNumber}`);
};

/** POST /api/admin/finance/requests/:id/reject { note } (the requester may also withdraw their own request) */
export const rejectRequest = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const { note: n } = parse(z.object({ note: note(3, "the reason") }), req.body);
  const me = currentUser(req);
  if (!me.permissions.includes("finance.approve")) {
    const [r] = await db.select({ requestedBy: financeRequests.requestedBy }).from(financeRequests).where(eq(financeRequests.id, id)).limit(1);
    if (!r || r.requestedBy !== me.id) throw notFound("Request not found");
  }
  await rejectFinanceRequest(id, staff(req), n);
  ok(res, null, "Request rejected");
};

// ================================================================================
// Journal
// ================================================================================
const journalListSchema = paginationSchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(entryTypeEnum.enumValues).optional(),
  agencyId: uuidSchema.optional(),
  bookingId: uuidSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

/** GET /api/admin/finance/journal */
export const listJournal = async (req: Request, res: Response) => {
  const q = parse(journalListSchema, req.query);
  const like = q.search ? `%${q.search.replace(/[%_]/g, "")}%` : null;
  const where = and(
    q.from ? gte(journalEntries.entryDate, q.from) : undefined,
    q.to ? lte(journalEntries.entryDate, q.to) : undefined,
    q.type ? eq(journalEntries.type, q.type) : undefined,
    q.agencyId ? eq(journalEntries.agencyId, q.agencyId) : undefined,
    q.bookingId ? eq(journalEntries.bookingId, q.bookingId) : undefined,
    like ? or(ilike(journalEntries.entryNumber, like), ilike(journalEntries.description, like), ilike(agencies.agencyName, like)) : undefined,
  );
  const [[total], items] = await Promise.all([
    db.select({ n: count() }).from(journalEntries).leftJoin(agencies, eq(agencies.id, journalEntries.agencyId)).where(where),
    db
      .select({
        id: journalEntries.id, entryNumber: journalEntries.entryNumber, entryDate: journalEntries.entryDate, type: journalEntries.type, description: journalEntries.description,
        amount: journalEntries.amount, currency: journalEntries.currency, agencyId: journalEntries.agencyId, agencyName: agencies.agencyName, agentCode: agencies.agentCode,
        createdByName: journalEntries.createdByName, approvedByName: journalEntries.approvedByName, reversalOfId: journalEntries.reversalOfId,
        reversed: sql<boolean>`exists (select 1 from journal_entries r where r.reversal_of_id = ${journalEntries.id})`,
      })
      .from(journalEntries)
      .leftJoin(agencies, eq(agencies.id, journalEntries.agencyId))
      .where(where)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
  ]);
  ok(res, { items: items.map((e) => ({ ...e, typeLabel: ENTRY_TYPE_LABEL[e.type] })), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
};

/** GET /api/admin/finance/journal/:id: entry with its lines. */
export const getJournalEntry = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const [row] = await db
    .select({
      e: journalEntries,
      agencyName: agencies.agencyName,
      agentCode: agencies.agentCode,
      bookingReference: sql<string | null>`(select b.reference from bookings b where b.id = ${journalEntries.bookingId})`,
      paymentReference: sql<string | null>`(select p.reference from payments p where p.id = ${journalEntries.paymentId})`,
      requestReference: sql<string | null>`(select r.reference from finance_requests r where r.id = ${journalEntries.requestId})`,
      reversalOfNumber: sql<string | null>`(select x.entry_number from journal_entries x where x.id = ${journalEntries.reversalOfId})`,
    })
    .from(journalEntries)
    .leftJoin(agencies, eq(agencies.id, journalEntries.agencyId))
    .where(eq(journalEntries.id, id))
    .limit(1);
  if (!row) throw notFound("Journal entry not found");
  const [lines, reversedBy, pendingReversal] = await Promise.all([
    db
      .select({ id: journalLines.id, accountId: journalLines.accountId, accountCode: ledgerAccounts.code, accountName: ledgerAccounts.name, agencyId: journalLines.agencyId, debit: journalLines.debit, credit: journalLines.credit, description: journalLines.description })
      .from(journalLines)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, id))
      .orderBy(desc(journalLines.debit)),
    db.select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber }).from(journalEntries).where(eq(journalEntries.reversalOfId, id)).limit(1),
    db.select({ reference: financeRequests.reference }).from(financeRequests).where(and(eq(financeRequests.reversalOfEntryId, id), eq(financeRequests.status, "pending"))).limit(1),
  ]);
  const { e, ...rest } = row;
  ok(res, { ...e, ...rest, typeLabel: ENTRY_TYPE_LABEL[e.type], lines, reversedBy: reversedBy[0] ?? null, pendingReversal: pendingReversal[0]?.reference ?? null });
};

// ================================================================================
// Chart of accounts and bank accounts
// ================================================================================

/** GET /api/admin/finance/accounts: every account with its totals (a trial balance). */
export const listAccounts = async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      a: ledgerAccounts,
      debit: sql<string>`coalesce((select sum(l.debit) from journal_lines l where l.account_id = "ledger_accounts"."id"), 0)`,
      credit: sql<string>`coalesce((select sum(l.credit) from journal_lines l where l.account_id = "ledger_accounts"."id"), 0)`,
    })
    .from(ledgerAccounts)
    .orderBy(asc(ledgerAccounts.sortOrder), asc(ledgerAccounts.code));
  const items = rows.map(({ a, debit, credit }) => ({ ...a, debit: r2(Number(debit)), credit: r2(Number(credit)), balance: r2(Number(debit) - Number(credit)) }));
  ok(res, {
    currency: await ledgerCurrency(),
    items,
    totals: { debit: r2(items.reduce((s, i) => s + i.debit, 0)), credit: r2(items.reduce((s, i) => s + i.credit, 0)) },
  });
};

const bankSchema = z.object({
  name: z.string().trim().min(2, "Enter the account name").max(120),
  code: z.string().trim().max(20).optional().nullable(),
  bankDetails: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
});

/** POST /api/admin/finance/accounts: a company bank account (agents can pay into active ones). */
export const createBankAccount = async (req: Request, res: Response) => {
  const data = parse(bankSchema, req.body);
  let code = data.code || "";
  if (!code) {
    const [last] = await db.select({ code: ledgerAccounts.code }).from(ledgerAccounts).where(and(eq(ledgerAccounts.isBank, true), sql`${ledgerAccounts.code} ~ '^10[0-9]{2}$'`)).orderBy(desc(ledgerAccounts.code)).limit(1);
    code = String(last ? Number(last.code) + 1 : 1010);
  }
  const [dup] = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).limit(1);
  if (dup) throw conflict("Another account already uses this code", [{ path: "code", message: "Already used" }]);
  const [acc] = await db.insert(ledgerAccounts).values({ code, name: data.name, type: "asset", isBank: true, bankDetails: data.bankDetails || null, isActive: data.isActive ?? true, sortOrder: 5 }).returning();
  await logAudit({ action: "finance.bank_account_created", entityType: "ledger_account", entityId: acc!.id, newValues: { code, name: data.name } });
  ok(res, acc, "Bank account added", 201);
};

/** PATCH /api/admin/finance/accounts/:id: rename any account; bank details and active flag for bank accounts. */
export const updateAccount = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(bankSchema.partial(), req.body);
  const [acc] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id)).limit(1);
  if (!acc) throw notFound("Account not found");
  const set: Partial<typeof ledgerAccounts.$inferInsert> = {};
  if (data.name) set.name = data.name;
  if (acc.isBank) {
    if (data.bankDetails !== undefined) set.bankDetails = data.bankDetails || null;
    if (data.isActive !== undefined) set.isActive = data.isActive;
    if (data.code && data.code !== acc.code) {
      const [dup] = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(and(eq(ledgerAccounts.code, data.code), ne(ledgerAccounts.id, id))).limit(1);
      if (dup) throw conflict("Another account already uses this code", [{ path: "code", message: "Already used" }]);
      set.code = data.code;
    }
  }
  if (Object.keys(set).length === 0) throw badRequest("Nothing to change");
  const [updated] = await db.update(ledgerAccounts).set(set).where(eq(ledgerAccounts.id, id)).returning();
  await logAudit({ action: "finance.account_updated", entityType: "ledger_account", entityId: id, oldValues: { name: acc.name, code: acc.code, isActive: acc.isActive }, newValues: set });
  ok(res, updated, "Account saved");
};

// ================================================================================
// Month closing
// ================================================================================
export const listPeriods = async (_req: Request, res: Response) => {
  ok(res, await db.select().from(accountingPeriods).orderBy(desc(accountingPeriods.month)));
};

/** POST /api/admin/finance/periods { month: YYYY-MM }: no entry can be dated in a closed month. */
export const closePeriod = async (req: Request, res: Response) => {
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM") }), req.body);
  const today = await todayInCompanyTz();
  if (month >= today.slice(0, 7)) throw badRequest("Only past months can be closed");
  const pending = await db
    .select({ ref: financeRequests.reference })
    .from(financeRequests)
    .where(and(eq(financeRequests.status, "pending"), sql`to_char(${financeRequests.entryDate}, 'YYYY-MM') = ${month}`))
    .limit(1);
  if (pending.length) throw conflict(`Request ${pending[0]!.ref} is dated in ${month} and still waiting for approval. Approve or reject it first.`);
  const me = staff(req);
  const [row] = await db.insert(accountingPeriods).values({ month, closedBy: me.id, closedByName: me.name }).onConflictDoNothing().returning();
  if (!row) throw conflict(`${month} is already closed`);
  await logAudit({ action: "finance.period_closed", entityType: "accounting_period", entityId: null, newValues: { month } });
  ok(res, row, `${month} closed`);
};

/** POST /api/admin/finance/periods/:month/reopen { reason }: reopen a month (logged). */
export const reopenPeriod = async (req: Request, res: Response) => {
  const month = String(req.params.month);
  const { reason } = parse(z.object({ reason: note(5, "the reason") }), req.body);
  const [row] = await db.delete(accountingPeriods).where(eq(accountingPeriods.month, month)).returning();
  if (!row) throw notFound("This month is not closed");
  await logAudit({ action: "finance.period_reopened", entityType: "accounting_period", entityId: null, oldValues: { month, closedBy: row.closedByName }, newValues: { reason } });
  ok(res, null, `${month} reopened`);
};

// ================================================================================
// Suppliers and booking costs (internal)
// ================================================================================
const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name").max(150),
  category: z.string().trim().max(60).optional().nullable(),
  contactName: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email("Enter a valid email").max(255).optional().nullable().or(z.literal("").transform(() => null)),
  address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const listSuppliers = async (req: Request, res: Response) => {
  const q = parse(z.object({ search: z.string().trim().max(100).optional(), includeInactive: z.enum(["true", "false"]).optional() }), req.query);
  const like = q.search ? `%${q.search.replace(/[%_]/g, "")}%` : null;
  const rows = await db
    .select({
      s: suppliers,
      bookings: sql<number>`(select count(distinct c.booking_id)::int from booking_costs c where c.supplier_id = "suppliers"."id")`,
      unpaid: sql<string>`coalesce((select sum(coalesce(c.actual_amount, c.estimated_amount)) from booking_costs c where c.supplier_id = "suppliers"."id" and not c.is_paid), 0)`,
    })
    .from(suppliers)
    .where(and(q.includeInactive === "true" ? undefined : eq(suppliers.isActive, true), like ? or(ilike(suppliers.name, like), ilike(suppliers.category, like)) : undefined))
    .orderBy(asc(suppliers.name));
  ok(res, rows.map(({ s, ...rest }) => ({ ...s, ...rest, unpaid: r2(Number(rest.unpaid)) })));
};

export const createSupplier = async (req: Request, res: Response) => {
  const data = parse(supplierSchema, req.body);
  const [s] = await db.insert(suppliers).values({ ...data, email: data.email ?? null }).returning();
  await logAudit({ action: "finance.supplier_created", entityType: "supplier", entityId: s!.id, newValues: { name: s!.name } });
  ok(res, s, "Supplier added", 201);
};

export const updateSupplier = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.id);
  const data = parse(supplierSchema.partial(), req.body);
  const [s] = await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning();
  if (!s) throw notFound("Supplier not found");
  await logAudit({ action: "finance.supplier_updated", entityType: "supplier", entityId: id, newValues: data });
  ok(res, s, "Supplier saved");
};

/** GET /api/admin/finance/bookings/:bookingId: what Finance needs on a booking (credit, postings, payments, costs, margin). */
export const bookingFinance = async (req: Request, res: Response) => {
  const bookingId = parse(uuidSchema, req.params.bookingId);
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b) throw notFound("Booking not found");
  const a = await loadAgency(b.agencyId);
  const [credit, entries, linkedPayments, requests, costs, charged] = await Promise.all([
    creditInfo(db, a),
    db
      .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber, entryDate: journalEntries.entryDate, type: journalEntries.type, description: journalEntries.description, amount: journalEntries.amount })
      .from(journalEntries)
      .where(eq(journalEntries.bookingId, bookingId))
      .orderBy(asc(journalEntries.createdAt)),
    db.select({ id: payments.id, reference: payments.reference, amount: payments.amount, status: payments.status, paidOn: payments.paidOn, method: payments.method }).from(payments).where(eq(payments.bookingId, bookingId)).orderBy(desc(payments.createdAt)),
    db.select().from(financeRequests).where(eq(financeRequests.bookingId, bookingId)).orderBy(desc(financeRequests.createdAt)),
    db
      .select({ c: bookingCosts, supplierName: suppliers.name })
      .from(bookingCosts)
      .leftJoin(suppliers, eq(suppliers.id, bookingCosts.supplierId))
      .where(eq(bookingCosts.bookingId, bookingId))
      .orderBy(asc(bookingCosts.createdAt)),
    chargedForBooking(db, bookingId),
  ]);
  const costRows = costs.map(({ c, supplierName }) => ({ ...c, supplierName }));
  const totalCost = r2(costRows.reduce((s, c) => s + Number(c.actualAmount ?? c.estimatedAmount), 0));
  const revenue = r2(Number(b.totalAmount));
  ok(res, {
    currency: credit.currency,
    credit,
    check: checkCredit(credit, revenue),
    charged,
    entries: entries.map((e) => ({ ...e, typeLabel: ENTRY_TYPE_LABEL[e.type] })),
    payments: linkedPayments.map((p) => ({ ...p, methodLabel: PAYMENT_METHOD_LABEL[p.method] })),
    requests: requests.map((r) => ({ ...r, kindLabel: REQUEST_KIND_LABEL[r.kind] })),
    costs: costRows,
    revenue,
    totalCost,
    margin: r2(revenue - totalCost),
    marginPercent: revenue > 0 ? Math.round(((revenue - totalCost) / revenue) * 1000) / 10 : null,
  });
};

const costSchema = z.object({
  supplierId: uuidSchema.optional().nullable().or(z.literal("").transform(() => null)),
  description: z.string().trim().min(2, "Describe the cost").max(200),
  estimatedAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  actualAmount: z.coerce.number().min(0).max(1_000_000_000).optional().nullable().or(z.literal("").transform(() => null)),
  supplierReference: z.string().trim().max(100).optional().nullable(),
  isPaid: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const addBookingCost = async (req: Request, res: Response) => {
  const bookingId = parse(uuidSchema, req.params.bookingId);
  const data = parse(costSchema, req.body);
  const [b] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b) throw notFound("Booking not found");
  const [c] = await db.insert(bookingCosts).values({ ...data, bookingId, createdBy: currentUser(req).id }).returning();
  await logAudit({ action: "finance.cost_added", entityType: "booking", entityId: bookingId, newValues: { description: c!.description, estimated: c!.estimatedAmount, actual: c!.actualAmount } });
  ok(res, c, "Cost added", 201);
};

export const updateBookingCost = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.costId);
  const data = parse(costSchema.partial(), req.body);
  const [c] = await db.update(bookingCosts).set(data).where(eq(bookingCosts.id, id)).returning();
  if (!c) throw notFound("Cost not found");
  await logAudit({ action: "finance.cost_updated", entityType: "booking", entityId: c.bookingId, newValues: { id, ...data } });
  ok(res, c, "Cost saved");
};

export const deleteBookingCost = async (req: Request, res: Response) => {
  const id = parse(uuidSchema, req.params.costId);
  const [c] = await db.delete(bookingCosts).where(eq(bookingCosts.id, id)).returning();
  if (!c) throw notFound("Cost not found");
  await logAudit({ action: "finance.cost_deleted", entityType: "booking", entityId: c.bookingId, oldValues: { description: c.description, estimated: c.estimatedAmount, actual: c.actualAmount } });
  ok(res, null, "Cost removed");
};

/** GET /api/admin/finance/options: agencies, bank accounts, suppliers for forms. */
export const financeOptions = async (_req: Request, res: Response) => {
  const [agencyRows, banks, supplierRows] = await Promise.all([
    db.select({ id: agencies.id, agencyName: agencies.agencyName, agentCode: agencies.agentCode }).from(agencies).where(sql`${agencies.agentCode} is not null`).orderBy(asc(agencies.agencyName)),
    db.select({ id: ledgerAccounts.id, code: ledgerAccounts.code, name: ledgerAccounts.name, isActive: ledgerAccounts.isActive }).from(ledgerAccounts).where(eq(ledgerAccounts.isBank, true)).orderBy(asc(ledgerAccounts.code)),
    db.select({ id: suppliers.id, name: suppliers.name, category: suppliers.category }).from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
  ]);
  ok(res, { currency: await ledgerCurrency(), agencies: agencyRows, banks, suppliers: supplierRows, methods: Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label })), requestKinds: Object.entries(REQUEST_KIND_LABEL).map(([value, label]) => ({ value, label })) });
};
