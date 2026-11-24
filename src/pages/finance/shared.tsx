import { Download, ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../../components/Toast";
import { Badge, Button, Field, Input, cx, type Tone } from "../../components/ui";
import { api, errorMessage } from "../../utils/api";
import { formatBytes, formatDate } from "../../utils/format";
import type { Attachment, CreditInfo, PaymentStatus, Statement } from "./types";

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for verification", tone: "amber" },
  clarification: { label: "Information needed", tone: "red" },
  verified: { label: "Verified", tone: "green" },
  rejected: { label: "Not accepted", tone: "red" },
  reversed: { label: "Reversed", tone: "slate" },
};

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = PAYMENT_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Money with 2 decimals only when needed. */
export function money(amount: number | string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Balance as words: what the agency owes, or has in credit. */
export function balanceText(balance: number, currency: string, forAgent: boolean) {
  if (balance > 0) return { label: forAgent ? "You owe" : "Agency owes", value: money(balance, currency), tone: "text-accent-700" };
  if (balance < 0) return { label: forAgent ? "Your credit with us" : "Agency credit (paid in advance)", value: money(-balance, currency), tone: "text-brand-700" };
  return { label: "Balance", value: money(0, currency), tone: "text-slate-900" };
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx("mt-1 text-xl font-bold", tone ?? "text-slate-900")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Balance, limit and what is available, for agent and staff. */
export function CreditStats({ credit, forAgent }: { credit: CreditInfo; forAgent: boolean }) {
  const b = balanceText(credit.balance, credit.currency, forAgent);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label={b.label} value={b.value} tone={b.tone} />
      <Stat
        label="Payment terms"
        value={credit.paymentTerms === "credit" ? "Credit" : "Advance payment"}
        hint={credit.paymentTerms === "credit" ? `Limit ${money(credit.creditLimit, credit.currency)}${credit.paymentTermsDays ? ` · ${credit.paymentTermsDays} days to pay` : ""}` : "Bookings are confirmed against payments received"}
      />
      <Stat label="Available for bookings" value={money(Math.max(0, credit.available), credit.currency)} tone={credit.available > 0 ? "text-brand-700" : "text-accent-700"} />
      <Stat label="Payments being verified" value={money(credit.pendingPayments, credit.currency)} hint="Added once verified" />
    </div>
  );
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="From"><Input type="date" value={f} onChange={(e) => setF(e.target.value)} /></Field>
      <Field label="To"><Input type="date" value={t} onChange={(e) => setT(e.target.value)} /></Field>
      <Button variant="secondary" onClick={() => onChange(f, t)} disabled={!f || !t}>Show</Button>
    </div>
  );
}

/** Statement with balance brought forward and running balance. Positive balance = owed to the company. */
/** Statement lines that have a printable document (receipt, invoice, credit note). */
const PRINTABLE = new Set(["payment", "booking_charge", "credit_note", "credit_adjustment"]);

export function StatementTable({ s, bookingLink, onEntry, documentPath }: { s: Statement; bookingLink: (id: string) => string; onEntry?: (entryId: string) => void; documentPath?: (entryId: string) => string }) {
  const toast = useToast();
  const bal = (n: number) => (n === 0 ? money(0, s.currency) : n > 0 ? `${money(n, s.currency)} Dr` : `${money(-n, s.currency)} Cr`);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Date</th><th className="px-4 py-3">Entry</th><th className="px-4 py-3">Details</th>
            <th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <tr className="bg-slate-50/50">
            <td className="px-4 py-2 whitespace-nowrap text-slate-500">{formatDate(s.from)}</td>
            <td colSpan={4} className="px-4 py-2 font-medium text-slate-600">Balance brought forward</td>
            <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{bal(s.openingBalance)}</td>
          </tr>
          {s.lines.map((l) => (
            <tr key={l.entryId} className="hover:bg-slate-50">
              <td className="px-4 py-2 whitespace-nowrap text-slate-600">{formatDate(l.entryDate)}</td>
              <td className="px-4 py-2 whitespace-nowrap">
                {onEntry ? <button className="font-mono text-xs text-brand-700 hover:underline" onClick={() => onEntry(l.entryId)}>{l.entryNumber}</button> : <span className="font-mono text-xs text-slate-500">{l.entryNumber}</span>}
                <p className="text-xs text-slate-500">{l.typeLabel}</p>
              </td>
              <td className="px-4 py-2 text-slate-800">
                {l.description}
                {l.bookingId && l.bookingReference && <Link to={bookingLink(l.bookingId)} className="ml-1 text-xs text-brand-700 hover:underline">{l.bookingReference}</Link>}
                {documentPath && PRINTABLE.has(l.type) && (
                  <button
                    className="ml-2 inline-flex items-center gap-0.5 align-middle text-xs text-brand-700 hover:underline"
                    title={l.type === "payment" ? "Receipt (PDF)" : l.type === "booking_charge" ? "Invoice (PDF)" : "Credit note (PDF)"}
                    onClick={() => api.openFile(documentPath(l.entryId)).catch((e) => toast("error", errorMessage(e)))}
                  >
                    <FileText className="size-3.5" />{l.type === "payment" ? "Receipt" : l.type === "booking_charge" ? "Invoice" : "Credit note"}
                  </button>
                )}
              </td>
              <td className="px-4 py-2 text-right whitespace-nowrap">{l.debit ? money(l.debit, s.currency) : ""}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">{l.credit ? money(l.credit, s.currency) : ""}</td>
              <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{bal(l.balance)}</td>
            </tr>
          ))}
          {s.lines.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No entries in this period.</td></tr>}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 font-semibold">
          <tr>
            <td colSpan={3} className="px-4 py-3">Totals and closing balance ({formatDate(s.to)})</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">{money(s.totalDebit, s.currency)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">{money(s.totalCredit, s.currency)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">{bal(s.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="px-4 py-2 text-xs text-slate-500">Dr = owed to us · Cr = credit in the agency's favour</p>
    </div>
  );
}

/** Downloads the statement shown as a CSV file (opens in Excel). */
export function statementCsv(s: Statement, title: string) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    [title],
    [`Period ${s.from} to ${s.to}`, `Currency ${s.currency}`],
    [],
    ["Date", "Entry", "Type", "Details", "Booking", "Debit", "Credit", "Balance"],
    [s.from, "", "", "Balance brought forward", "", "", "", s.openingBalance],
    ...s.lines.map((l) => [l.entryDate, l.entryNumber, l.typeLabel, l.description, l.bookingReference ?? "", l.debit || "", l.credit || "", l.balance]),
    ["", "", "", "Totals", "", s.totalDebit, s.totalCredit, s.closingBalance],
  ];
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `statement-${s.from}-to-${s.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function CsvButton({ s, title }: { s: Statement; title: string }) {
  return <Button size="sm" variant="secondary" icon={Download} onClick={() => statementCsv(s, title)}>Download CSV</Button>;
}

export function AttachmentList({ files, basePath }: { files: Attachment[]; basePath: string }) {
  const toast = useToast();
  if (!files.length) return <p className="text-sm text-slate-500">No receipt attached.</p>;
  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <FileText className="size-4 text-brand-600" />
          <span className="min-w-0 flex-1 truncate">{f.fileName} <span className="text-xs text-slate-400">· {formatBytes(f.sizeBytes)}</span></span>
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => api.openFile(`${basePath}/${f.id}`).catch((e) => toast("error", errorMessage(e)))}>Open</Button>
        </li>
      ))}
    </ul>
  );
}

/** First day of last month to today, matching the server default. */
export function defaultRange() {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(today) };
}

export const todayIso = () => defaultRange().to;
