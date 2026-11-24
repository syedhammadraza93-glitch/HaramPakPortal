import { Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Spinner, Textarea, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { formatDate } from "../../../utils/format";
import { PaymentStatusBadge, REQUEST_STATUS, money } from "../../finance/shared";
import type { PaymentStatus } from "../../finance/types";
import { JournalEntryModal, useFinanceOptions } from "./modals";

interface Cost {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  description: string;
  estimatedAmount: number;
  actualAmount: number | null;
  supplierReference: string | null;
  isPaid: boolean;
  notes: string | null;
}

interface BookingFinance {
  currency: string;
  charged: number;
  entries: { id: string; entryNumber: string; entryDate: string; typeLabel: string; description: string; amount: number }[];
  payments: { id: string; reference: string; amount: number; status: PaymentStatus; paidOn: string; methodLabel: string }[];
  requests: { id: string; reference: string; kindLabel: string; amount: number; status: string }[];
  costs: Cost[];
  revenue: number;
  totalCost: number;
  margin: number;
  marginPercent: number | null;
}

/** Finance view of a booking: what was posted, payments, supplier costs and margin. Never shown to agents. */
export function BookingFinanceCard({ bookingId, refreshKey }: { bookingId: string; refreshKey: string }) {
  const toast = useToast();
  const canManage = useCan("finance.manage");
  const { data: d, loading, reload } = useApi<BookingFinance>(`/admin/finance/bookings/${bookingId}`, { v: refreshKey });
  const { data: opts } = useFinanceOptions();
  const [editing, setEditing] = useState<Cost | "new" | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  const empty = { supplierId: "", description: "", estimatedAmount: "", actualAmount: "", supplierReference: "", isPaid: false, notes: "" };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (loading && !d) return <Card><Spinner /></Card>;
  if (!d) return null;

  const open = (c: Cost | "new") => {
    setErrors({});
    setF(c === "new" ? empty : { supplierId: c.supplierId ?? "", description: c.description, estimatedAmount: String(c.estimatedAmount), actualAmount: c.actualAmount === null ? "" : String(c.actualAmount), supplierReference: c.supplierReference ?? "", isPaid: c.isPaid, notes: c.notes ?? "" });
    setEditing(c);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const body = { ...f, estimatedAmount: Number(f.estimatedAmount) || 0, actualAmount: f.actualAmount === "" ? null : Number(f.actualAmount) };
    try {
      const res = editing === "new" ? await api.post(`/admin/finance/bookings/${bookingId}/costs`, body) : await api.patch(`/admin/finance/costs/${(editing as Cost).id}`, body);
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
  const remove = async (c: Cost) => {
    if (!confirm(`Remove "${c.description}"?`)) return;
    try {
      await api.del(`/admin/finance/costs/${c.id}`);
      void reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader icon={Calculator} title="Finance" description="Internal: never shown to the agent." actions={canManage && <Button size="sm" icon={Plus} onClick={() => open("new")}>Add cost</Button>} />
      <div className="space-y-5 p-5 text-sm">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Sale</p><p className="font-semibold">{money(d.revenue, d.currency)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Costs</p><p className="font-semibold">{money(d.totalCost, d.currency)}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Margin</p><p className={cx("font-semibold", d.margin < 0 ? "text-accent-700" : "text-brand-700")}>{money(d.margin, d.currency)}{d.marginPercent !== null && <span className="text-xs font-normal"> ({d.marginPercent}%)</span>}</p></div>
        </div>

        {d.costs.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {d.costs.map((c) => (
              <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800">{c.description} {c.isPaid ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Unpaid</Badge>}</p>
                  <p className="text-xs text-slate-500">{c.supplierName ?? "No supplier"}{c.supplierReference ? ` · ${c.supplierReference}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{money(c.actualAmount ?? c.estimatedAmount, d.currency)}</p>
                  <p className="text-xs text-slate-400">{c.actualAmount === null ? "estimate" : `est. ${money(c.estimatedAmount, d.currency)}`}</p>
                </div>
                {canManage && <><Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(c)} aria-label="Edit" /><Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(c)} aria-label="Remove" /></>}
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ledger</p>
          {d.entries.length === 0 ? <p className="text-slate-500">Nothing posted yet. The booking is charged to the agency when it is confirmed.</p> : (
            <ul className="space-y-1">
              {d.entries.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <button className="text-left text-brand-700 hover:underline" onClick={() => setEntry(e.id)}><span className="font-mono text-xs">{e.entryNumber}</span> {e.typeLabel}</button>
                  <span>{money(e.amount, d.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {d.payments.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Payments for this booking</p>
            <ul className="space-y-1">
              {d.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <Link to={`/admin/finance/payments/${p.id}`} className="text-brand-700 hover:underline"><span className="font-mono text-xs">{p.reference}</span> {formatDate(p.paidOn)}</Link>
                  <span className="flex items-center gap-2">{money(p.amount, d.currency)} <PaymentStatusBadge status={p.status} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.requests.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Finance requests</p>
            <ul className="space-y-1">
              {d.requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link to="/admin/finance?tab=approvals" className="text-brand-700 hover:underline"><span className="font-mono text-xs">{r.reference}</span> {r.kindLabel}</Link>
                  <span className="flex items-center gap-2">{money(r.amount, d.currency)} <Badge tone={REQUEST_STATUS[r.status]?.tone}>{REQUEST_STATUS[r.status]?.label}</Badge></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing === "new" ? "Add cost" : "Edit cost"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="cost-form" loading={saving}>Save</Button></>}>
        <form id="cost-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="What for" required error={errors.description} className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Makkah hotel 13 nights" invalid={!!errors.description} /></Field>
          <Field label="Supplier" hint={opts && !opts.suppliers.length ? "Add suppliers under Finance → Suppliers" : undefined}>
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">None</option>
              {opts?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.category ? ` (${s.category})` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Supplier reference"><Input value={f.supplierReference} onChange={(e) => setF({ ...f, supplierReference: e.target.value })} /></Field>
          <Field label={`Estimated (${d.currency})`}><Input type="number" min={0} value={f.estimatedAmount} onChange={(e) => setF({ ...f, estimatedAmount: e.target.value })} /></Field>
          <Field label={`Actual (${d.currency})`} hint="Fill in when the invoice arrives"><Input type="number" min={0} value={f.actualAmount} onChange={(e) => setF({ ...f, actualAmount: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-16" /></Field>
          <Checkbox label="Paid to the supplier" checked={f.isPaid} onChange={(e) => setF({ ...f, isPaid: e.target.checked })} />
        </form>
      </Modal>
      {entry && <JournalEntryModal id={entry} onClose={() => setEntry(null)} onChanged={reload} />}
    </Card>
  );
}
