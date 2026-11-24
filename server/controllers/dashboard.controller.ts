import { and, asc, count, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../database/connection";
import { agencies, bookingDocuments, bookings, financeRequests, journalEntries, journalLines, packageDepartures, packages, payments } from "../database/schema";
import { currentUser } from "../middleware/auth.middleware";
import { ENTRY_TYPE_LABEL, creditInfo, ledgerCurrency, r2, systemAccountId } from "../services/ledger.service";
import { todayInCompanyTz } from "../services/settings.service";
import { forbidden, ok } from "../utils/http";
import { activeAnnouncementsFor } from "./communication.controller";

const QUEUE_STATUSES = ["submitted", "under_review", "information_required", "quotation_sent", "awaiting_payment", "payment_pending_verification"] as const;
const ACTIVE_STATUSES = ["confirmed", "processing", "documents_issued"] as const;

/** First day of the month `back` months before the month of `today` (YYYY-MM-DD). */
function monthStart(today: string, back = 0): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 10);
}

// ================================================================================
// Agent dashboard
// ================================================================================

/** GET /api/agent/dashboard */
export const agentDashboard = async (req: Request, res: Response) => {
  const me = currentUser(req);
  if (me.type !== "agent" || !me.agency) throw forbidden("Agent account required");
  const agencyId = me.agency.id;
  const [agency] = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  const announcements = await activeAnnouncementsFor(agencyId, agency?.pricingGroupId ?? null);
  if (me.agency.status !== "active" || !agency) {
    ok(res, { active: false, announcements });
    return;
  }
  const today = await todayInCompanyTz();
  const recv = await systemAccountId(db, "agency_receivable");
  const [credit, counts, recent, trips, awaiting] = await Promise.all([
    creditInfo(db, agency),
    db.select({ status: bookings.status, n: count() }).from(bookings).where(and(eq(bookings.agencyId, agencyId), ne(bookings.status, "draft"))).groupBy(bookings.status),
    db
      .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber, entryDate: journalEntries.entryDate, type: journalEntries.type, description: journalEntries.description, debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalLines.accountId, recv), eq(journalLines.agencyId, agencyId)))
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
      .limit(6),
    db
      .select({ id: bookings.id, reference: bookings.reference, packageName: bookings.packageName, departureDate: bookings.departureDate, paxCount: bookings.paxCount, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.agencyId, agencyId), inArray(bookings.status, [...ACTIVE_STATUSES]), gte(bookings.departureDate, today)))
      .orderBy(asc(bookings.departureDate))
      .limit(5),
    db.select({ n: count() }).from(bookings).where(and(eq(bookings.agencyId, agencyId), eq(bookings.status, "awaiting_payment"))),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const sumOf = (list: readonly string[]) => list.reduce((s, k) => s + (byStatus[k] ?? 0), 0);
  ok(res, {
    active: true,
    ...(me.agency.access.finance ? { credit, recentEntries: recent.map((e) => ({ ...e, debit: Number(e.debit), credit: Number(e.credit), typeLabel: ENTRY_TYPE_LABEL[e.type] })) } : {}),
    ...(me.agency.access.bookings ? {
    bookingCounts: byStatus,
    bookingGroups: { inProgress: sumOf(QUEUE_STATUSES), confirmed: sumOf(ACTIVE_STATUSES), completed: byStatus.completed ?? 0, cancelled: sumOf(["cancelled", "rejected", "refunded"]) },
    awaitingPayment: awaiting[0]?.n ?? 0,
    upcomingTrips: trips,
    } : {}),
    announcements,
  });
};

// ================================================================================
// Admin dashboard: each section only for users who may see it
// ================================================================================

/** GET /api/admin/dashboard */
export const adminDashboard = async (req: Request, res: Response) => {
  const perms = new Set(currentUser(req).permissions);
  const can = (p: string) => perms.has(p as never);
  const today = await todayInCompanyTz();
  const thisMonth = monthStart(today);
  const currency = await ledgerCurrency();
  const out: Record<string, unknown> = { currency, today };

  const tasks: Promise<void>[] = [];

  if (can("agent.view")) {
    tasks.push(
      (async () => {
        const [byStatus, waiting, [last7]] = await Promise.all([
          db.select({ status: agencies.status, total: count() }).from(agencies).groupBy(agencies.status),
          db
            .select({ id: agencies.id, agencyName: agencies.agencyName, city: agencies.city, status: agencies.status, createdAt: agencies.createdAt })
            .from(agencies)
            .where(inArray(agencies.status, ["pending_approval", "information_required"]))
            .orderBy(asc(agencies.createdAt))
            .limit(5),
          db.select({ total: count() }).from(agencies).where(gte(agencies.createdAt, new Date(Date.now() - 7 * 86_400_000))),
        ]);
        out.agencies = { counts: Object.fromEntries(byStatus.map((r) => [r.status, r.total])), waitingForReview: waiting, registrationsLast7Days: last7?.total ?? 0 };
      })(),
    );
  }

  if (can("booking.view")) {
    tasks.push(
      (async () => {
        const [byStatus, [docs], [confirmedThisMonth]] = await Promise.all([
          db.select({ status: bookings.status, n: count() }).from(bookings).where(ne(bookings.status, "draft")).groupBy(bookings.status),
          db
            .select({ n: count() })
            .from(bookingDocuments)
            .innerJoin(bookings, eq(bookings.id, bookingDocuments.bookingId))
            .where(and(eq(bookingDocuments.status, "pending"), eq(bookingDocuments.issued, false), ne(bookings.status, "draft"), ne(bookings.status, "cancelled"))),
          db.select({ n: count() }).from(bookings).where(gte(bookings.confirmedAt, new Date(`${thisMonth}T00:00:00Z`))),
        ]);
        const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
        out.bookings = {
          counts,
          queue: QUEUE_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0),
          active: ACTIVE_STATUSES.reduce((s, k) => s + (counts[k] ?? 0), 0),
          documentsToCheck: docs?.n ?? 0,
          confirmedThisMonth: confirmedThisMonth?.n ?? 0,
        };
      })(),
    );
  }

  if (can("report.view") || can("finance.view")) {
    tasks.push(
      (async () => {
        // Sales from the ledger: booking charges less reversed charges, by month and product type.
        const rows = await db.execute(sql`
          select to_char(e.entry_date, 'YYYY-MM') as month, b.vertical,
            sum(case when e.type = 'booking_charge' then e.amount else -e.amount end) as amount,
            count(distinct case when e.type = 'booking_charge' then e.booking_id end)::int as bookings
          from journal_entries e
          join bookings b on b.id = e.booking_id
          left join journal_entries o on o.id = e.reversal_of_id
          where e.entry_date >= ${monthStart(today, 5)} and e.entry_date <= ${today}
            and (e.type = 'booking_charge' or (e.type = 'reversal' and o.type = 'booking_charge'))
          group by 1, 2 order by 1`);
        const months = Array.from({ length: 6 }, (_, i) => monthStart(today, 5 - i).slice(0, 7));
        const series = months.map((m) => {
          const inMonth = (rows.rows as any[]).filter((r) => r.month === m);
          return { month: m, umrah: r2(Number(inMonth.find((r) => r.vertical === "umrah")?.amount ?? 0)), hajj: r2(Number(inMonth.find((r) => r.vertical === "hajj")?.amount ?? 0)), tourism: r2(Number(inMonth.find((r) => r.vertical === "tourism")?.amount ?? 0)), bookings: inMonth.reduce((s, r) => s + Number(r.bookings), 0) };
        });
        const current = series[series.length - 1]!;
        out.sales = { months: series, thisMonth: { umrah: current.umrah, hajj: current.hajj, tourism: current.tourism, total: r2(current.umrah + current.hajj + current.tourism), bookings: current.bookings } };
      })(),
    );
  }

  if (can("finance.view")) {
    tasks.push(
      (async () => {
        const recv = await systemAccountId(db, "agency_receivable");
        const [balances, [collected], [toVerify], [requests]] = await Promise.all([
          db.execute(sql`select l.agency_id, sum(l.debit - l.credit) as balance from journal_lines l where l.account_id = ${recv} group by l.agency_id`),
          db.execute(sql`
            select coalesce(sum(case when e.type = 'payment' then e.amount else -e.amount end), 0) as amount
            from journal_entries e left join journal_entries o on o.id = e.reversal_of_id
            where e.entry_date between ${thisMonth} and ${today} and (e.type = 'payment' or (e.type = 'reversal' and o.type = 'payment'))`).then((r) => r.rows as any[]),
          db.select({ n: count(), total: sql<string>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(inArray(payments.status, ["pending", "clarification"])),
          db.select({ n: count() }).from(financeRequests).where(eq(financeRequests.status, "pending")),
        ]);
        const list = (balances.rows as any[]).map((b) => Number(b.balance));
        out.finance = {
          receivable: r2(list.reduce((s, b) => s + Math.max(0, b), 0)),
          agencyCredit: r2(list.reduce((s, b) => s + Math.max(0, -b), 0)),
          collectedThisMonth: r2(Number(collected?.amount ?? 0)),
          paymentsToVerify: toVerify?.n ?? 0,
          paymentsToVerifyAmount: r2(Number(toVerify?.total ?? 0)),
          requestsToApprove: requests?.n ?? 0,
        };
      })(),
    );
  }

  if (can("catalogue.view")) {
    tasks.push(
      (async () => {
        const until = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10);
        out.capacity = await db
          .select({
            id: packageDepartures.id, packageId: packages.id, packageName: packages.name, packageCode: packages.code, vertical: packages.vertical,
            departureDate: packageDepartures.departureDate, capacity: packageDepartures.capacity, seatsSold: packageDepartures.seatsSold, seatsHeld: packageDepartures.seatsHeld, status: packageDepartures.status,
          })
          .from(packageDepartures)
          .innerJoin(packages, eq(packages.id, packageDepartures.packageId))
          .where(and(gte(packageDepartures.departureDate, today), lte(packageDepartures.departureDate, until), ne(packageDepartures.status, "cancelled"), eq(packages.status, "published")))
          .orderBy(asc(packageDepartures.departureDate))
          .limit(10);
      })(),
    );
  }

  await Promise.all(tasks);
  ok(res, out);
};
