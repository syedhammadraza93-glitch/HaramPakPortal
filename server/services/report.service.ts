import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { db } from "../database/connection";
import type { PermissionCode } from "../utils/permissions";
import { badRequest } from "../utils/http";
import { VERTICAL_LABEL } from "../utils/labels";
import { BOOKING_STATUS_LABEL } from "./booking.service";
import { brandContext, esc, fmtDate, money, renderDocument, table } from "./documents/layout";
import { ledgerCurrency, r2, systemAccountId } from "./ledger.service";
import { PAYMENT_METHOD_LABEL } from "./payment.service";
import { htmlToPdf } from "./pdf.service";

export type ColumnType = "text" | "money" | "number" | "date" | "percent";
export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}
export interface Report {
  key: string;
  title: string;
  subtitle: string;
  currency: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
}
export interface ReportParams {
  from: string;
  to: string;
  asOf: string;
  groupBy: string | undefined;
}

/** Report catalogue: what each one needs and which group-by options it has. */
export const REPORTS = {
  sales: { title: "Sales", description: "Bookings charged to agencies, less reversals and credit notes. From the ledger.", needs: ["report.view"], range: true, groupBy: { vertical: "Product type", destination: "Destination", package: "Package", agent: "Agency", month: "Month" } },
  collections: { title: "Collections", description: "Payments verified and posted, less reversed payments.", needs: ["report.view"], range: true, groupBy: { agent: "Agency", method: "Payment method", bank: "Bank account", month: "Month" } },
  receivables: { title: "Receivables & credit", description: "What each agency owes on a date, aged by how long it has been due, and how much of its credit limit it uses.", needs: ["report.view", "finance.view"], range: false, groupBy: {} },
  cancellations: { title: "Cancellations & refunds", description: "Bookings cancelled in the period with their cancellation charge and the amount credited back.", needs: ["report.view"], range: true, groupBy: {} },
  profit: { title: "Profit", description: "Sales against supplier costs for bookings charged in the period. Internal.", needs: ["report.view", "finance.view"], range: true, groupBy: { booking: "Booking", vertical: "Product type", package: "Package", agent: "Agency" } },
  "supplier-costs": { title: "Supplier costs", description: "Costs per supplier for bookings charged in the period: estimated, actual, paid and unpaid. Internal.", needs: ["report.view", "finance.view"], range: true, groupBy: {} },
} as const satisfies Record<string, { title: string; description: string; needs: PermissionCode[]; range: boolean; groupBy: Record<string, string> }>;
export type ReportKey = keyof typeof REPORTS;

const num = (v: unknown) => r2(Number(v ?? 0));
const verticalLabel = (v: unknown) => VERTICAL_LABEL[v as keyof typeof VERTICAL_LABEL] ?? String(v ?? "");

function pickGroup<K extends ReportKey>(key: K, groupBy: string | undefined): string {
  const options = Object.keys(REPORTS[key].groupBy);
  const g = groupBy ?? options[0];
  if (!g || !options.includes(g)) throw badRequest(`Group by one of: ${options.join(", ")}`);
  return g;
}

function sumTotals(rows: Report["rows"], columns: ReportColumn[], label: string): Report["totals"] {
  const t: Record<string, string | number | null> = {};
  columns.forEach((c, i) => {
    if (i === 0) t[c.key] = label;
    else if (c.type === "money" || c.type === "number") t[c.key] = r2(rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0));
    else t[c.key] = null;
  });
  return t;
}

// ================================================================================
// Sales (ledger)
// ================================================================================
const SALES_GROUP: Record<string, string> = {
  vertical: "b.vertical::text",
  destination: "coalesce(d.city || ', ' || d.country, 'No destination')",
  package: "p.code || ' · ' || p.name",
  agent: "a.agency_name || coalesce(' (' || a.agent_code || ')', '')",
  month: "to_char(e.entry_date, 'YYYY-MM')",
};

async function salesReport(p: ReportParams): Promise<Report> {
  const g = pickGroup("sales", p.groupBy);
  const result = await db.execute(sql`
    select ${sql.raw(SALES_GROUP[g]!)} as grp,
      count(distinct case when e.type = 'booking_charge' then e.booking_id end)::int as bookings,
      coalesce(sum(case when e.type = 'booking_charge' then b.pax_count end), 0)::int as pax,
      coalesce(sum(case when e.type = 'booking_charge' then e.amount end), 0) as gross,
      coalesce(sum(case when e.type = 'reversal' and o.type = 'booking_charge' then e.amount end), 0) as reversed,
      coalesce(sum(case when e.type = 'credit_note' then e.amount end), 0) as credited
    from journal_entries e
    join bookings b on b.id = e.booking_id
    join packages p on p.id = b.package_id
    join agencies a on a.id = b.agency_id
    left join destinations d on d.id = p.destination_id
    left join journal_entries o on o.id = e.reversal_of_id
    where e.entry_date between ${p.from} and ${p.to}
      and (e.type in ('booking_charge', 'credit_note') or (e.type = 'reversal' and o.type = 'booking_charge'))
    group by 1 order by 1`);
  const rows = (result.rows as any[]).map((r) => {
    const gross = num(r.gross);
    const reversed = num(r.reversed);
    const credited = num(r.credited);
    return { group: g === "vertical" ? verticalLabel(r.grp) : r.grp, bookings: Number(r.bookings), pax: Number(r.pax), gross, reversed, credited, net: r2(gross - reversed - credited) };
  });
  const columns: ReportColumn[] = [
    { key: "group", label: REPORTS.sales.groupBy[g as keyof typeof REPORTS.sales.groupBy], type: "text" },
    { key: "bookings", label: "Bookings", type: "number" },
    { key: "pax", label: "Passengers", type: "number" },
    { key: "gross", label: "Sales", type: "money" },
    { key: "reversed", label: "Reversed", type: "money" },
    { key: "credited", label: "Credit notes", type: "money" },
    { key: "net", label: "Net sales", type: "money" },
  ];
  return { key: "sales", title: "Sales", subtitle: "", currency: await ledgerCurrency(), columns, rows, totals: sumTotals(rows, columns, "Total") };
}

// ================================================================================
// Collections (ledger)
// ================================================================================
const COLLECTION_GROUP: Record<string, string> = {
  agent: "a.agency_name || coalesce(' (' || a.agent_code || ')', '')",
  method: "pm.method::text",
  bank: "coalesce(ba.name, 'Unknown')",
  month: "to_char(e.entry_date, 'YYYY-MM')",
};

async function collectionsReport(p: ReportParams): Promise<Report> {
  const g = pickGroup("collections", p.groupBy);
  const result = await db.execute(sql`
    select ${sql.raw(COLLECTION_GROUP[g]!)} as grp,
      count(case when e.type = 'payment' then 1 end)::int as payments,
      coalesce(sum(case when e.type = 'payment' then e.amount end), 0) as received,
      coalesce(sum(case when e.type = 'reversal' then e.amount end), 0) as reversed
    from journal_entries e
    left join journal_entries o on o.id = e.reversal_of_id
    join payments pm on pm.id = coalesce(e.payment_id, o.payment_id)
    join agencies a on a.id = pm.agency_id
    left join ledger_accounts ba on ba.id = pm.bank_account_id
    where e.entry_date between ${p.from} and ${p.to}
      and (e.type = 'payment' or (e.type = 'reversal' and o.type = 'payment'))
    group by 1 order by 1`);
  const rows = (result.rows as any[]).map((r) => {
    const received = num(r.received);
    const reversed = num(r.reversed);
    return { group: g === "method" ? PAYMENT_METHOD_LABEL[r.grp as keyof typeof PAYMENT_METHOD_LABEL] ?? r.grp : r.grp, payments: Number(r.payments), received, reversed, net: r2(received - reversed) };
  });
  const columns: ReportColumn[] = [
    { key: "group", label: REPORTS.collections.groupBy[g as keyof typeof REPORTS.collections.groupBy], type: "text" },
    { key: "payments", label: "Payments", type: "number" },
    { key: "received", label: "Received", type: "money" },
    { key: "reversed", label: "Reversed", type: "money" },
    { key: "net", label: "Net collected", type: "money" },
  ];
  return { key: "collections", title: "Collections", subtitle: "", currency: await ledgerCurrency(), columns, rows, totals: sumTotals(rows, columns, "Total") };
}

// ================================================================================
// Receivables, ageing and credit utilisation (as of a date)
// ================================================================================
async function receivablesReport(p: ReportParams): Promise<Report> {
  const recv = await systemAccountId(db, "agency_receivable");
  const result = await db.execute(sql`
    select a.id, a.agency_name, a.agent_code, a.payment_terms, a.credit_limit, e.entry_date, l.debit, l.credit
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join agencies a on a.id = l.agency_id
    where l.account_id = ${recv} and e.entry_date <= ${p.asOf}
    order by a.agency_name, e.entry_date, e.created_at`);
  type Acc = { name: string; code: string | null; terms: string; limit: number; debits: { date: string; amount: number }[]; credits: number };
  const byAgency = new Map<string, Acc>();
  for (const r of result.rows as any[]) {
    let acc = byAgency.get(r.id);
    if (!acc) byAgency.set(r.id, (acc = { name: r.agency_name, code: r.agent_code, terms: r.payment_terms, limit: Number(r.credit_limit), debits: [], credits: 0 }));
    const date = typeof r.entry_date === "string" ? r.entry_date.slice(0, 10) : new Date(r.entry_date).toISOString().slice(0, 10);
    if (Number(r.debit) > 0) acc.debits.push({ date, amount: Number(r.debit) });
    acc.credits += Number(r.credit);
  }
  const asOf = Date.parse(p.asOf);
  const rows: Report["rows"] = [];
  for (const acc of byAgency.values()) {
    const balance = r2(acc.debits.reduce((s, d) => s + d.amount, 0) - acc.credits);
    if (balance === 0) continue;
    // Credits settle the oldest debits first; what is left is aged by its date.
    const buckets = [0, 0, 0, 0];
    let credit = acc.credits;
    for (const d of acc.debits) {
      const open = Math.max(0, d.amount - credit);
      credit = Math.max(0, credit - d.amount);
      if (!open) continue;
      const age = Math.floor((asOf - Date.parse(d.date)) / 86_400_000);
      buckets[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3]! += open;
    }
    rows.push({
      group: `${acc.name}${acc.code ? ` (${acc.code})` : ""}`,
      terms: acc.terms === "credit" ? "Credit" : "Advance",
      limit: acc.terms === "credit" ? acc.limit : 0,
      balance,
      b0: r2(buckets[0]!),
      b1: r2(buckets[1]!),
      b2: r2(buckets[2]!),
      b3: r2(buckets[3]!),
      utilisation: acc.terms === "credit" && acc.limit > 0 && balance > 0 ? Math.round((balance / acc.limit) * 1000) / 10 : null,
    });
  }
  rows.sort((a, b) => Number(b.balance) - Number(a.balance));
  const columns: ReportColumn[] = [
    { key: "group", label: "Agency", type: "text" },
    { key: "terms", label: "Terms", type: "text" },
    { key: "limit", label: "Credit limit", type: "money" },
    { key: "balance", label: "Balance (Dr + / Cr −)", type: "money" },
    { key: "b0", label: "0–30 days", type: "money" },
    { key: "b1", label: "31–60 days", type: "money" },
    { key: "b2", label: "61–90 days", type: "money" },
    { key: "b3", label: "Over 90 days", type: "money" },
    { key: "utilisation", label: "Limit used", type: "percent" },
  ];
  const totals = sumTotals(rows, columns, "Total");
  if (totals) totals.limit = null;
  return { key: "receivables", title: "Receivables & credit", subtitle: "", currency: await ledgerCurrency(), columns, rows, totals };
}

// ================================================================================
// Cancellations and refunds
// ================================================================================
async function cancellationsReport(p: ReportParams): Promise<Report> {
  const result = await db.execute(sql`
    select b.reference, b.status, b.vertical, b.package_name, b.cancelled_at, b.cancel_reason, b.total_amount, b.cancellation_charge, b.confirmed_at,
      a.agency_name, a.agent_code,
      coalesce((select sum(r.amount) from finance_requests r where r.booking_id = b.id and r.kind = 'credit_note' and r.status = 'approved'), 0) as credited,
      coalesce((select sum(r.amount) from finance_requests r where r.booking_id = b.id and r.kind = 'credit_note' and r.status = 'pending'), 0) as pending_credit
    from bookings b join agencies a on a.id = b.agency_id
    where b.cancelled_at is not null and (b.cancelled_at at time zone 'UTC')::date between ${p.from} and ${p.to}
      and b.status in ('cancelled', 'refunded')
    order by b.cancelled_at`);
  const rows = (result.rows as any[]).map((r) => ({
    group: r.reference,
    agency: `${r.agency_name}${r.agent_code ? ` (${r.agent_code})` : ""}`,
    package: r.package_name,
    vertical: verticalLabel(r.vertical),
    cancelledAt: new Date(r.cancelled_at).toISOString().slice(0, 10),
    stage: r.confirmed_at ? "After confirmation" : "Before confirmation",
    total: r.confirmed_at ? num(r.total_amount) : 0,
    charge: num(r.cancellation_charge),
    credited: num(r.credited),
    pending: num(r.pending_credit),
    status: BOOKING_STATUS_LABEL[r.status as keyof typeof BOOKING_STATUS_LABEL] ?? r.status,
    reason: r.cancel_reason ?? "",
  }));
  const columns: ReportColumn[] = [
    { key: "group", label: "Booking", type: "text" },
    { key: "agency", label: "Agency", type: "text" },
    { key: "package", label: "Package", type: "text" },
    { key: "cancelledAt", label: "Cancelled", type: "date" },
    { key: "stage", label: "When", type: "text" },
    { key: "total", label: "Charged", type: "money" },
    { key: "charge", label: "Cancellation charge", type: "money" },
    { key: "credited", label: "Credited back", type: "money" },
    { key: "pending", label: "Credit awaiting approval", type: "money" },
    { key: "status", label: "Status", type: "text" },
    { key: "reason", label: "Reason", type: "text" },
  ];
  return { key: "cancellations", title: "Cancellations & refunds", subtitle: "", currency: await ledgerCurrency(), columns, rows, totals: sumTotals(rows, columns, `${rows.length} bookings`) };
}

// ================================================================================
// Profit and supplier costs (internal)
// ================================================================================
const PROFIT_GROUP: Record<string, string> = {
  booking: "b.reference",
  vertical: "b.vertical::text",
  package: "p.code || ' · ' || p.name",
  agent: "a.agency_name || coalesce(' (' || a.agent_code || ')', '')",
};

/** Bookings charged in the period and not reversed since. */
const CHARGED_BOOKINGS = (p: ReportParams) => sql`
  select e.booking_id, sum(e.amount) as charged from journal_entries e
  where e.type = 'booking_charge' and e.entry_date between ${p.from} and ${p.to}
    and not exists (select 1 from journal_entries r where r.reversal_of_id = e.id)
  group by e.booking_id`;

async function profitReport(p: ReportParams): Promise<Report> {
  const g = pickGroup("profit", p.groupBy);
  const result = await db.execute(sql`
    with charged as (${CHARGED_BOOKINGS(p)})
    select ${sql.raw(PROFIT_GROUP[g]!)} as grp,
      count(*)::int as bookings,
      sum(c.charged) as sales,
      sum(coalesce((select sum(r.amount) from finance_requests r where r.booking_id = b.id and r.kind = 'credit_note' and r.status = 'approved'), 0)) as credited,
      sum(coalesce((select sum(coalesce(bc.actual_amount, bc.estimated_amount)) from booking_costs bc where bc.booking_id = b.id), 0)) as cost
    from charged c
    join bookings b on b.id = c.booking_id
    join packages p on p.id = b.package_id
    join agencies a on a.id = b.agency_id
    group by 1 order by 1`);
  const rows = (result.rows as any[]).map((r) => {
    const revenue = r2(num(r.sales) - num(r.credited));
    const cost = num(r.cost);
    const margin = r2(revenue - cost);
    return { group: g === "vertical" ? verticalLabel(r.grp) : r.grp, bookings: Number(r.bookings), sales: num(r.sales), credited: num(r.credited), revenue, cost, margin, marginPercent: revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null };
  });
  const columns: ReportColumn[] = [
    { key: "group", label: REPORTS.profit.groupBy[g as keyof typeof REPORTS.profit.groupBy], type: "text" },
    { key: "bookings", label: "Bookings", type: "number" },
    { key: "sales", label: "Sales", type: "money" },
    { key: "credited", label: "Credit notes", type: "money" },
    { key: "revenue", label: "Net revenue", type: "money" },
    { key: "cost", label: "Supplier cost", type: "money" },
    { key: "margin", label: "Margin", type: "money" },
    { key: "marginPercent", label: "Margin %", type: "percent" },
  ];
  const totals = sumTotals(rows, columns, "Total");
  if (totals) {
    const rev = Number(totals.revenue);
    totals.marginPercent = rev > 0 ? Math.round((Number(totals.margin) / rev) * 1000) / 10 : null;
  }
  return { key: "profit", title: "Profit", subtitle: "", currency: await ledgerCurrency(), columns, rows, totals };
}

async function supplierCostsReport(p: ReportParams): Promise<Report> {
  const result = await db.execute(sql`
    with charged as (${CHARGED_BOOKINGS(p)})
    select coalesce(s.name, 'No supplier') as grp, coalesce(s.category, '') as category,
      count(distinct bc.booking_id)::int as bookings,
      sum(bc.estimated_amount) as estimated,
      sum(bc.actual_amount) as actual,
      sum(case when bc.is_paid then coalesce(bc.actual_amount, bc.estimated_amount) else 0 end) as paid,
      sum(case when not bc.is_paid then coalesce(bc.actual_amount, bc.estimated_amount) else 0 end) as unpaid
    from booking_costs bc
    join charged c on c.booking_id = bc.booking_id
    left join suppliers s on s.id = bc.supplier_id
    group by s.id, s.name, s.category order by 1`);
  const rows = (result.rows as any[]).map((r) => ({ group: r.grp, category: r.category, bookings: Number(r.bookings), estimated: num(r.estimated), actual: num(r.actual), paid: num(r.paid), unpaid: num(r.unpaid) }));
  const columns: ReportColumn[] = [
    { key: "group", label: "Supplier", type: "text" },
    { key: "category", label: "Category", type: "text" },
    { key: "bookings", label: "Bookings", type: "number" },
    { key: "estimated", label: "Estimated", type: "money" },
    { key: "actual", label: "Actual (invoiced)", type: "money" },
    { key: "paid", label: "Paid", type: "money" },
    { key: "unpaid", label: "Unpaid", type: "money" },
  ];
  return { key: "supplier-costs", title: "Supplier costs", subtitle: "", currency: await ledgerCurrency(), columns, rows, totals: sumTotals(rows, columns, "Total") };
}

const BUILDERS: Record<ReportKey, (p: ReportParams) => Promise<Report>> = {
  sales: salesReport,
  collections: collectionsReport,
  receivables: receivablesReport,
  cancellations: cancellationsReport,
  profit: profitReport,
  "supplier-costs": supplierCostsReport,
};

export async function runReport(key: ReportKey, p: ReportParams): Promise<Report> {
  if (REPORTS[key].range && p.from > p.to) throw badRequest("The start date is after the end date");
  const report = await BUILDERS[key](p);
  const group = Object.keys(REPORTS[key].groupBy).length ? ` · by ${(REPORTS[key].groupBy as Record<string, string>)[pickGroup(key as any, p.groupBy)]?.toLowerCase()}` : "";
  report.subtitle = REPORTS[key].range ? `${fmtDate(p.from)} to ${fmtDate(p.to)}${group}` : `As of ${fmtDate(p.asOf)}`;
  return report;
}

// ================================================================================
// Export
// ================================================================================
function formatCell(v: unknown, type: ColumnType, currency: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money") return money(Number(v), currency);
  if (type === "number") return Number(v).toLocaleString("en-US");
  if (type === "percent") return `${v}%`;
  if (type === "date") return fmtDate(String(v));
  return String(v);
}

export async function reportToXlsx(r: Report, companyName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([companyName]).font = { bold: true, size: 13 };
  ws.addRow([`${r.title}: ${r.subtitle}`]).font = { bold: true };
  ws.addRow([`Amounts in ${r.currency}`]).font = { italic: true, color: { argb: "FF6B7280" } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } }));
  const cellValue = (v: unknown, c: ReportColumn) => {
    if (v === null || v === undefined || v === "") return null;
    if (c.type === "money" || c.type === "number") return Number(v);
    if (c.type === "percent") return Number(v) / 100;
    if (c.type === "date") return new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    return String(v);
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => cellValue(row[c.key], c)));
  if (r.totals) ws.addRow(r.columns.map((c) => cellValue(r.totals![c.key], c))).font = { bold: true };
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.type === "text" ? Math.min(45, Math.max(14, c.label.length + 4)) : 16;
    if (c.type === "money") col.numFmt = "#,##0.00";
    if (c.type === "number") col.numFmt = "#,##0";
    if (c.type === "percent") col.numFmt = "0.0%";
    if (c.type === "date") col.numFmt = "dd mmm yyyy";
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function reportToPdf(r: Report): Promise<Buffer> {
  const ctx = await brandContext(r.title);
  const right = (t: ColumnType) => (t === "text" || t === "date" ? undefined : ("right" as const));
  const html = renderDocument(ctx, {
    date: new Date(),
    headerLines: [r.subtitle, `Amounts in ${r.currency}`],
    body: table(
      r.columns.map((c) => ({ label: c.label, align: right(c.type) })),
      r.rows.map((row) => r.columns.map((c) => esc(formatCell(row[c.key], c.type, r.currency)))),
      r.totals ? [r.columns.map((c) => esc(formatCell(r.totals![c.key], c.type, r.currency)))] : undefined,
    ),
  });
  return htmlToPdf(html, { landscape: r.columns.length > 6, footerNote: `${ctx.company.name} · ${r.title} · ${r.subtitle}` });
}
