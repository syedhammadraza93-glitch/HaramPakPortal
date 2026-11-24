import { Banknote, BookOpenCheck, Building2, Check, Lock, Pencil, Plus, Search, Truck, Unlock, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, Textarea, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { formatDate, formatDateTime } from "../../../utils/format";
import { PaymentStatusBadge, REQUEST_STATUS, Stat, balanceText, money } from "../../finance/shared";
import type { FinanceRequestRow, PaymentRow } from "../../finance/types";
import { JournalEntryModal, RecordPaymentModal, RequestModal, useFinanceOptions } from "./modals";

const TABS = [
  { key: "overview", label: "Agency balances" },
  { key: "payments", label: "Payments" },
  { key: "approvals", label: "Approvals" },
  { key: "journal", label: "Journal" },
  { key: "accounts", label: "Accounts & months" },
  { key: "suppliers", label: "Suppliers" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

interface Summary {
  currency: string;
  receivable: number;
  agencyCredit: number;
  agenciesOwing: number;
  overLimit: number;
  pendingPayments: number;
  pendingPaymentsAmount: number;
  pendingRequests: number;
}

export function Finance() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "overview") as TabKey;
  const { data: s, reload } = useApi<Summary>("/admin/finance/summary");

  return (
    <div className="space-y-6">
      <PageHeader title="Finance" description="Agency ledgers, payments, approvals and the journal." />
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Owed by agencies" value={money(s.receivable, s.currency)} hint={`${s.agenciesOwing} agencies`} tone="text-accent-700" />
          <Stat label="Agency credit held" value={money(s.agencyCredit, s.currency)} hint="Advances and credit notes" tone="text-brand-700" />
          <Stat label="Payments to verify" value={String(s.pendingPayments)} hint={money(s.pendingPaymentsAmount, s.currency)} />
          <Stat label="Waiting for approval" value={String(s.pendingRequests)} hint={s.overLimit ? `${s.overLimit} agencies over their limit` : "No agency over its limit"} />
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setParams({ tab: t.key })} className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>
            {t.label}
            {t.key === "payments" && s?.pendingPayments ? <span className="ml-1.5 rounded-full bg-gold-400 px-1.5 text-xs text-slate-900">{s.pendingPayments}</span> : null}
            {t.key === "approvals" && s?.pendingRequests ? <span className="ml-1.5 rounded-full bg-gold-400 px-1.5 text-xs text-slate-900">{s.pendingRequests}</span> : null}
          </button>
        ))}
      </div>
      {tab === "overview" && <Balances />}
      {tab === "payments" && <Payments onChanged={reload} />}
      {tab === "approvals" && <Approvals onChanged={reload} />}
      {tab === "journal" && <Journal />}
      {tab === "accounts" && <Accounts />}
      {tab === "suppliers" && <Suppliers />}
    </div>
  );
}

// ---------------- Agency balances ----------------
interface BalanceRow {
  id: string;
  agencyName: string;
  agentCode: string | null;
  city: string;
  status: string;
  paymentTerms: "advance" | "credit";
  creditLimit: number;
  creditPolicy: "warn" | "block";
  balance: number;
  available: number;
  overLimit: boolean;
  lastPayment: string | null;
  pendingPayments: number;
}

function Balances() {
  const [q, setQ] = useState({ search: "", filter: "all", page: 1 });
  const [search, setSearch] = useState("");
  const { data, loading } = useApi<{ items: BalanceRow[]; total: number; page: number; pageSize: number }>("/admin/finance/agencies", { ...q, pageSize: 25 });
  const { data: opts } = useFinanceOptions();
  const currency = opts?.currency ?? "";
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
        <form onSubmit={(e) => { e.preventDefault(); setQ({ ...q, search, page: 1 }); }} className="flex gap-2">
          <Input placeholder="Agency, code or city" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="secondary" icon={Search} type="submit">Search</Button>
        </form>
        <Select value={q.filter} onChange={(e) => setQ({ ...q, filter: e.target.value, page: 1 })} className="w-auto">
          <option value="all">All agencies</option>
          <option value="owing">Owing money</option>
          <option value="credit">In credit</option>
          <option value="over_limit">Over their limit</option>
        </Select>
      </div>
      {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState icon={Building2} title="No agencies" /> : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Agency</th><th className="px-4 py-3">Terms</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3 text-right">Available</th><th className="px-4 py-3">Last payment</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((a) => {
                  const b = balanceText(a.balance, currency, false);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><Link to={`/admin/finance/agencies/${a.id}`} className="font-medium text-brand-700 hover:underline">{a.agencyName}</Link><p className="text-xs text-slate-500">{a.agentCode} · {a.city}</p></td>
                      <td className="px-4 py-3 text-slate-600">{a.paymentTerms === "credit" ? `Credit, limit ${money(a.creditLimit, currency)}` : "Advance"}<p className="text-xs text-slate-400">{a.creditPolicy === "block" ? "Blocks over limit" : "Warns over limit"}</p></td>
                      <td className={cx("px-4 py-3 text-right font-medium whitespace-nowrap", b.tone)}>{a.balance === 0 ? "—" : `${money(Math.abs(a.balance), currency)} ${a.balance > 0 ? "Dr" : "Cr"}`}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{money(Math.max(0, a.available), currency)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{a.lastPayment ? formatDate(a.lastPayment) : "—"}</td>
                      <td className="px-4 py-3">
                        {a.overLimit && <Badge tone="red">Over limit</Badge>}
                        {a.pendingPayments > 0 && <Badge tone="amber" className="ml-1">{a.pendingPayments} to verify</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}
    </Card>
  );
}

// ---------------- Payments ----------------
function Payments({ onChanged }: { onChanged: () => void }) {
  const navigate = useNavigate();
  const canManage = useCan("finance.manage");
  const [q, setQ] = useState({ status: "open", search: "", page: 1 });
  const [search, setSearch] = useState("");
  const { data, loading } = useApi<{ items: PaymentRow[]; total: number; page: number; pageSize: number }>("/admin/finance/payments", { ...q, status: q.status || undefined, pageSize: 25 });
  const { data: opts } = useFinanceOptions();
  const [recording, setRecording] = useState(false);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
        <Select value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value, page: 1 })} className="w-auto">
          <option value="open">To verify</option>
          <option value="verified">Verified</option>
          <option value="rejected">Not accepted</option>
          <option value="reversed">Reversed</option>
          <option value="">All</option>
        </Select>
        <form onSubmit={(e) => { e.preventDefault(); setQ({ ...q, search, page: 1 }); }} className="flex gap-2">
          <Input placeholder="Reference, agency, transaction no." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button variant="secondary" icon={Search} type="submit">Search</Button>
        </form>
        <div className="flex-1" />
        {canManage && opts && <Button icon={Plus} onClick={() => setRecording(true)}>Record payment</Button>}
      </div>
      {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState icon={Banknote} title="No payments here" /> : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Agency</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Paid on</th><th className="px-4 py-3">For</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/admin/finance/payments/${p.id}`)}>
                    <td className="px-4 py-3"><span className="font-mono text-xs text-brand-700">{p.reference}</span><p className="text-xs text-slate-400">{formatDateTime(p.createdAt)}{p.submittedByType === "staff" ? " · by staff" : ""}</p></td>
                    <td className="px-4 py-3"><p className="text-slate-800">{p.agencyName}</p><p className="text-xs text-slate-500">{p.agentCode}</p></td>
                    <td className="px-4 py-3 text-slate-600">{p.methodLabel}<p className="text-xs text-slate-400">{p.bankName ?? ""}{p.transactionRef ? ` · ${p.transactionRef}` : ""}</p></td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(p.paidOn)}</td>
                    <td className="px-4 py-3 text-slate-600">{p.bookingReference ?? "On account"}</td>
                    <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{money(p.amount, p.currency)}</td>
                    <td className="px-4 py-3"><PaymentStatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}
      {recording && opts && <RecordPaymentModal options={opts} onClose={() => setRecording(false)} onDone={(id) => { setRecording(false); onChanged(); navigate(`/admin/finance/payments/${id}`); }} />}
    </Card>
  );
}

// ---------------- Approvals (maker-checker) ----------------
export function RequestList({ agencyId, onChanged }: { agencyId?: string; onChanged?: () => void }) {
  const toast = useToast();
  const canManage = useCan("finance.manage");
  const [q, setQ] = useState({ status: "pending", page: 1 });
  const { data, loading, reload } = useApi<{ items: FinanceRequestRow[]; total: number; page: number; pageSize: number }>("/admin/finance/requests", { ...q, status: q.status || undefined, agencyId, pageSize: 20 });
  const { data: opts } = useFinanceOptions();
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ r: FinanceRequestRow; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewEntry, setViewEntry] = useState<string | null>(null);

  const decide = async () => {
    if (!deciding) return;
    setBusy(true);
    try {
      const res = await api.post(`/admin/finance/requests/${deciding.r.id}/${deciding.approve ? "approve" : "reject"}`, { note: note || null });
      toast("success", res.message ?? "Done");
      setDeciding(null);
      void reload();
      onChanged?.();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader icon={BookOpenCheck} title="Finance requests" description="Opening balances, charges, credits, refunds and reversals. A different finance user approves each one." actions={canManage && opts && <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New request</Button>} />
      <div className="border-b border-slate-100 px-4 pb-3">
        <Select value={q.status} onChange={(e) => setQ({ status: e.target.value, page: 1 })} className="w-auto">
          <option value="pending">Waiting for approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </Select>
      </div>
      {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState icon={BookOpenCheck} title="Nothing here" /> : (
        <>
          <ul className="divide-y divide-slate-100">
            {data.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-4 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{r.reference}</span>
                    <Badge tone="blue">{r.kindLabel}</Badge>
                    <Badge tone={REQUEST_STATUS[r.status]!.tone}>{REQUEST_STATUS[r.status]!.label}</Badge>
                    <span className="font-semibold text-slate-900">{money(r.amount, opts?.currency ?? "")}</span>
                    {r.kind === "opening_balance" && <span className="text-xs text-slate-500">{r.agencyOwes ? "agency owes" : "agency in credit"}</span>}
                  </div>
                  <p className="text-sm text-slate-700">
                    {r.agencyName && <Link to={`/admin/finance/agencies/${r.agencyId}`} className="font-medium text-brand-700 hover:underline">{r.agencyName}</Link>}
                    {r.bookingReference && <> · <Link to={`/admin/bookings/${r.bookingId}`} className="text-brand-700 hover:underline">{r.bookingReference}</Link></>}
                    {r.reversalOfNumber && <> · reverses {r.reversalOfNumber}</>}
                    {r.accountName && <> · from {r.accountName}</>}
                    {r.entryDate && <> · dated {formatDate(r.entryDate)}</>}
                  </p>
                  <p className="text-sm text-slate-600">{r.reason}</p>
                  {r.description && <p className="text-xs text-slate-500">Agency sees: “{r.description}”</p>}
                  <p className="text-xs text-slate-400">
                    Requested by {r.requestedByName} · {formatDateTime(r.createdAt)}
                    {r.reviewedByName && ` · ${r.status} by ${r.reviewedByName}${r.reviewNote ? `: ${r.reviewNote}` : ""}`}
                  </p>
                  {r.entryNumber && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setViewEntry(r.journalEntryId)}>Posted as {r.entryNumber}</button>}
                </div>
                {r.status === "pending" && (
                  <div className="flex gap-2">
                    {r.canApprove && <Button size="sm" icon={Check} onClick={() => { setDeciding({ r, approve: true }); setNote(""); }}>Approve</Button>}
                    {canManage && <Button size="sm" variant="secondary" icon={X} onClick={() => { setDeciding({ r, approve: false }); setNote(""); }}>Reject</Button>}
                    {!r.canApprove && <span className="self-center text-xs text-slate-400">Needs another approver</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}
      {creating && opts && <RequestModal options={opts} agencyId={agencyId} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void reload(); onChanged?.(); }} />}
      <Modal open={!!deciding} onClose={() => setDeciding(null)} title={deciding ? `${deciding.approve ? "Approve" : "Reject"} ${deciding.r.reference}` : ""}
        footer={<><Button variant="secondary" onClick={() => setDeciding(null)}>Cancel</Button><Button variant={deciding?.approve ? "primary" : "danger"} loading={busy} disabled={!deciding?.approve && note.trim().length < 3} onClick={decide}>{deciding?.approve ? "Approve and post" : "Reject"}</Button></>}>
        {deciding && (
          <div className="space-y-3">
            {deciding.approve && <Alert tone="info">{deciding.r.kindLabel} of <b>{money(deciding.r.amount, opts?.currency ?? "")}</b>{deciding.r.agencyName ? ` for ${deciding.r.agencyName}` : ""} will be posted to the ledger. Posted entries cannot be edited.</Alert>}
            <Field label={deciding.approve ? "Note (optional)" : "Reason"} required={!deciding.approve}><Textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
          </div>
        )}
      </Modal>
      {viewEntry && <JournalEntryModal id={viewEntry} onClose={() => setViewEntry(null)} />}
    </Card>
  );
}


function Approvals({ onChanged }: { onChanged: () => void }) {
  return <RequestList onChanged={onChanged} />;
}

// ---------------- Journal ----------------
interface JournalRow {
  id: string;
  entryNumber: string;
  entryDate: string;
  type: string;
  typeLabel: string;
  description: string;
  amount: number;
  currency: string;
  agencyId: string | null;
  agencyName: string | null;
  agentCode: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  reversalOfId: string | null;
  reversed: boolean;
}

const ENTRY_TYPES: Record<string, string> = {
  booking_charge: "Booking",
  payment: "Payment received",
  credit_note: "Credit note",
  additional_charge: "Additional charge",
  credit_adjustment: "Credit adjustment",
  refund_payout: "Refund paid",
  opening_balance: "Opening balance",
  reversal: "Reversal",
};

function Journal() {
  const [q, setQ] = useState({ from: "", to: "", type: "", search: "", page: 1 });
  const [draft, setDraft] = useState(q);
  const { data, loading, reload } = useApi<{ items: JournalRow[]; total: number; page: number; pageSize: number }>("/admin/finance/journal", { ...q, from: q.from || undefined, to: q.to || undefined, type: q.type || undefined, search: q.search || undefined, pageSize: 30 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden">
      <form onSubmit={(e) => { e.preventDefault(); setQ({ ...draft, page: 1 }); }} className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
        <Field label="From"><Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
        <Field label="Type">
          <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="">All types</option>
            {Object.entries(ENTRY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Search"><Input placeholder="Entry no., text, agency" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} /></Field>
        <Button type="submit" variant="secondary" icon={Search}>Show</Button>
      </form>
      {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState icon={BookOpenCheck} title="No journal entries" /> : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Entry</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Details</th><th className="px-4 py-3">Agency</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">By</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(e.id)}>
                    <td className="px-4 py-3"><span className="font-mono text-xs text-brand-700">{e.entryNumber}</span><p className="text-xs text-slate-500">{e.typeLabel}</p></td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(e.entryDate)}</td>
                    <td className="px-4 py-3 text-slate-800">{e.description}{e.reversed && <Badge tone="slate" className="ml-2">Reversed</Badge>}</td>
                    <td className="px-4 py-3 text-slate-600">{e.agencyName ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{money(e.amount, e.currency)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{e.createdByName ?? "System"}{e.approvedByName ? <><br />✓ {e.approvedByName}</> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}
      {open && <JournalEntryModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </Card>
  );
}

// ---------------- Accounts and month closing ----------------
interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  systemKey: string | null;
  isBank: boolean;
  bankDetails: string | null;
  isActive: boolean;
  debit: number;
  credit: number;
  balance: number;
}

function Accounts() {
  const toast = useToast();
  const canManage = useCan("finance.manage");
  const canApprove = useCan("finance.approve");
  const { data, loading, reload } = useApi<{ currency: string; items: Account[]; totals: { debit: number; credit: number } }>("/admin/finance/accounts");
  const periods = useApi<{ month: string; closedAt: string; closedByName: string | null }[]>("/admin/finance/periods");
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [f, setF] = useState({ name: "", code: "", bankDetails: "", isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState("");
  const [reopen, setReopen] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const open = (a: Account | "new") => {
    setErrors({});
    setF(a === "new" ? { name: "", code: "", bankDetails: "", isActive: true } : { name: a.name, code: a.code, bankDetails: a.bankDetails ?? "", isActive: a.isActive });
    setEditing(a);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = editing === "new" ? await api.post("/admin/finance/accounts", f) : await api.patch(`/admin/finance/accounts/${(editing as Account).id}`, (editing as Account).isBank ? f : { name: f.name });
      toast("success", res.message ?? "Saved");
      setEditing(null);
      void reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const close = async () => {
    try {
      const res = await api.post("/admin/finance/periods", { month });
      toast("success", res.message ?? "Closed");
      setMonth("");
      void periods.reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };
  const reopenMonth = async () => {
    if (!reopen) return;
    setSaving(true);
    try {
      const res = await api.post(`/admin/finance/periods/${reopen}/reopen`, { reason });
      toast("success", res.message ?? "Reopened");
      setReopen(null);
      void periods.reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const typeLabel: Record<string, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };
  return (
    <div className="grid gap-6 2xl:grid-cols-3">
      <Card className="overflow-hidden 2xl:col-span-2">
        <CardHeader title="Chart of accounts" description="Totals of every posted entry (trial balance). Bank accounts are the accounts agents can pay into." actions={canManage && <Button size="sm" icon={Plus} onClick={() => open("new")}>Add bank account</Button>} />
        {loading && !data ? <Spinner /> : data && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((a) => (
                  <tr key={a.id} className={cx(!a.isActive && "opacity-60")}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.code}</td>
                    <td className="px-4 py-3">
                      <span className="text-slate-900">{a.name}</span>
                      {a.isBank && <Badge tone="green" className="ml-2">Bank</Badge>}
                      {!a.isActive && <Badge tone="slate" className="ml-2">Inactive</Badge>}
                      {a.bankDetails && <p className="whitespace-pre-line text-xs text-slate-500">{a.bankDetails}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{typeLabel[a.type]}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{a.debit ? money(a.debit, data.currency) : ""}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{a.credit ? money(a.credit, data.currency) : ""}</td>
                    <td className="px-4 py-3 text-right">{canManage && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(a)} aria-label="Edit" />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 font-semibold">
                <tr>
                  <td colSpan={3} className="px-4 py-3">Totals {data.totals.debit === data.totals.credit ? <Badge tone="green" className="ml-2">Balanced</Badge> : <Badge tone="red" className="ml-2">Not balanced</Badge>}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(data.totals.debit, data.currency)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(data.totals.credit, data.currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader icon={Lock} title="Closed months" description="No entry can be dated in a closed month. Close a month after its statements are final." />
        {canApprove && (
          <div className="flex items-end gap-2 border-b border-slate-100 p-4">
            <Field label="Month to close"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
            <Button icon={Lock} disabled={!month} onClick={close}>Close month</Button>
          </div>
        )}
        {!periods.data?.length ? <p className="p-5 text-sm text-slate-500">No month is closed yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {periods.data.map((p) => (
              <li key={p.month} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Lock className="size-4 text-slate-400" />
                <span className="flex-1"><b>{p.month}</b><span className="block text-xs text-slate-500">{p.closedByName} · {formatDateTime(p.closedAt)}</span></span>
                {canApprove && <Button size="sm" variant="ghost" icon={Unlock} onClick={() => { setReopen(p.month); setReason(""); }}>Reopen</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add bank account" : "Edit account"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="acc-form" loading={saving}>Save</Button></>}>
        <form id="acc-form" onSubmit={save} className="space-y-4">
          <Field label="Account name" required error={errors.name} hint={editing !== "new" && editing && !editing.isBank ? "This account is used by the posting rules; only its name can be changed." : "e.g. Meezan Bank – Current account"}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!errors.name} />
          </Field>
          {(editing === "new" || (editing && editing.isBank)) && (
            <>
              <Field label="Account code" hint="Leave empty to number it automatically" error={errors.code}><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
              <Field label="Details shown to agents" hint="Account title, account number, IBAN, branch"><Textarea value={f.bankDetails} onChange={(e) => setF({ ...f, bankDetails: e.target.value })} /></Field>
              <Checkbox label="Active (agents can pay into it)" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
            </>
          )}
        </form>
      </Modal>

      <Modal open={!!reopen} onClose={() => setReopen(null)} title={`Reopen ${reopen}`}
        footer={<><Button variant="secondary" onClick={() => setReopen(null)}>Cancel</Button><Button variant="danger" loading={saving} disabled={reason.trim().length < 5} onClick={reopenMonth}>Reopen month</Button></>}>
        <Field label="Reason" required hint="Kept in the audit log."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>
    </div>
  );
}

// ---------------- Suppliers ----------------
interface Supplier {
  id: string;
  name: string;
  category: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  bookings: number;
  unpaid: number;
}

function Suppliers() {
  const toast = useToast();
  const canManage = useCan("finance.manage");
  const [showInactive, setShowInactive] = useState(false);
  const { data, loading, reload } = useApi<Supplier[]>("/admin/finance/suppliers", { includeInactive: showInactive ? "true" : undefined });
  const { data: opts } = useFinanceOptions();
  const empty = { name: "", category: "", contactName: "", phone: "", email: "", address: "", notes: "", isActive: true };
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const open = (s: Supplier | "new") => {
    setErrors({});
    setF(s === "new" ? empty : { name: s.name, category: s.category ?? "", contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", notes: s.notes ?? "", isActive: s.isActive });
    setEditing(s);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = editing === "new" ? await api.post("/admin/finance/suppliers", f) : await api.patch(`/admin/finance/suppliers/${(editing as Supplier).id}`, f);
      toast("success", res.message ?? "Saved");
      setEditing(null);
      void reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  return (
    <Card className="overflow-hidden">
      <CardHeader icon={Truck} title="Suppliers" description="Hotels, transport, visa and ground operators. Costs are added on each booking and never shown to agents." actions={canManage && <Button size="sm" icon={Plus} onClick={() => open("new")}>Add supplier</Button>} />
      <div className="border-b border-slate-100 px-4 pb-3"><Checkbox label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /></div>
      {loading && !data ? <Spinner /> : !data?.length ? <EmptyState icon={Truck} title="No suppliers yet" /> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Bookings</th><th className="px-4 py-3 text-right">Not yet paid</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((s) => (
                <tr key={s.id} className={cx(!s.isActive && "opacity-60")}>
                  <td className="px-4 py-3"><p className="font-medium text-slate-900">{s.name}</p><p className="text-xs text-slate-500">{s.category}</p></td>
                  <td className="px-4 py-3 text-slate-600">{s.contactName}<p className="text-xs text-slate-500">{[s.phone, s.email].filter(Boolean).join(" · ")}</p></td>
                  <td className="px-4 py-3 text-slate-600">{s.bookings}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{money(s.unpaid, opts?.currency ?? "")}</td>
                  <td className="px-4 py-3 text-right">{canManage && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(s)} aria-label="Edit" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing === "new" ? "Add supplier" : "Edit supplier"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="sup-form" loading={saving}>Save</Button></>}>
        <form id="sup-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => set("name", e.target.value)} invalid={!!errors.name} /></Field>
          <Field label="Category" hint="e.g. Hotel, Transport, Visa"><Input value={f.category} onChange={(e) => set("category", e.target.value)} /></Field>
          <Field label="Contact person"><Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Address"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" /></Field>
          <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}
