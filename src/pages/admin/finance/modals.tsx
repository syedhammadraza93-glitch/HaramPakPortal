import { RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Alert, Badge, Button, Field, Input, Select, Spinner, Textarea } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { formatDate, formatDateTime } from "../../../utils/format";
import { money, todayIso } from "../../finance/shared";
import type { FinanceOptions, RequestKind } from "../../finance/types";

export const useFinanceOptions = () => useApi<FinanceOptions>("/admin/finance/options");

const KIND_HELP: Record<Exclude<RequestKind, "reversal">, string> = {
  opening_balance: "Balance carried over from before the portal. Only one per agency.",
  additional_charge: "Charge the agency for something outside a booking (e.g. re-issue fee). The agency owes more.",
  credit_adjustment: "Discount or goodwill credit. The agency owes less.",
  credit_note: "Credit for a booking (e.g. partial refund). The agency owes less.",
  refund_payout: "Money paid back to the agency from a company bank account. Uses up the agency's credit.",
};

/** A manual posting; a second finance user approves it before it reaches the ledger. */
export function RequestModal({ options, agencyId, bookingId, kind: presetKind, onClose, onDone }: {
  options: FinanceOptions;
  agencyId?: string;
  bookingId?: string;
  kind?: Exclude<RequestKind, "reversal">;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({ kind: presetKind ?? ("additional_charge" as Exclude<RequestKind, "reversal">), agencyId: agencyId ?? "", amount: "", agencyOwes: "true", accountId: "", entryDate: "", description: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await api.post("/admin/finance/requests", {
        kind: f.kind, agencyId: f.agencyId || null, bookingId: bookingId ?? null, amount: Number(f.amount) || 0, agencyOwes: f.agencyOwes === "true",
        accountId: f.accountId || null, entryDate: f.entryDate || null, description: f.description || null, reason: f.reason,
      });
      toast("success", res.message ?? "Sent for approval");
      onDone();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="New finance request" description="Nothing is posted until a different finance user approves it."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="fin-request" loading={saving}>Send for approval</Button></>}>
      <form id="fin-request" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" required className="sm:col-span-2" hint={KIND_HELP[f.kind]}>
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value)} disabled={!!presetKind}>
            {options.requestKinds.filter((k) => k.value !== "reversal").map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Agency" required error={errors.agencyId}>
          <Select value={f.agencyId} onChange={(e) => set("agencyId", e.target.value)} disabled={!!agencyId} invalid={!!errors.agencyId}>
            <option value="">Choose agency</option>
            {options.agencies.map((a) => <option key={a.id} value={a.id}>{a.agencyName}{a.agentCode ? ` (${a.agentCode})` : ""}</option>)}
          </Select>
        </Field>
        <Field label={`Amount (${options.currency})`} required error={errors.amount}><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} invalid={!!errors.amount} /></Field>
        {f.kind === "opening_balance" && (
          <Field label="Direction" required>
            <Select value={f.agencyOwes} onChange={(e) => set("agencyOwes", e.target.value)}>
              <option value="true">Agency owes us</option>
              <option value="false">Agency has paid in advance (credit)</option>
            </Select>
          </Field>
        )}
        {f.kind === "refund_payout" && (
          <Field label="Paid from bank account" required error={errors.accountId}>
            <Select value={f.accountId} onChange={(e) => set("accountId", e.target.value)} invalid={!!errors.accountId}>
              <option value="">Choose account</option>
              {options.banks.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Entry date" hint="Leave empty to use the approval date" error={errors.entryDate}><Input type="date" max={todayIso()} value={f.entryDate} onChange={(e) => set("entryDate", e.target.value)} /></Field>
        <Field label="Text on the agency's statement" hint="Optional. The agency sees this." className="sm:col-span-2"><Input value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={200} /></Field>
        <Field label="Reason (internal)" required error={errors.reason} className="sm:col-span-2" hint="Seen by finance staff only, kept in the audit log.">
          <Textarea value={f.reason} onChange={(e) => set("reason", e.target.value)} invalid={!!errors.reason} />
        </Field>
      </form>
    </Modal>
  );
}

/** Money received that Finance records itself (e.g. cash at the office). Another finance user verifies it. */
export function RecordPaymentModal({ options, agencyId, onClose, onDone }: { options: FinanceOptions; agencyId?: string; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ agencyId: agencyId ?? "", method: "cash", bankAccountId: "", amount: "", paidOn: todayIso(), transactionRef: "", notes: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    files.forEach((file) => fd.append("files", file));
    setSaving(true);
    setErrors({});
    try {
      const res = await api.postForm<{ id: string }>("/admin/finance/payments", fd);
      toast("success", res.message ?? "Recorded");
      onDone(res.data.id);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Record a payment received" description="Another finance user verifies it before it reaches the ledger."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="rec-pay" loading={saving}>Record payment</Button></>}>
      <form id="rec-pay" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Agency" required error={errors.agencyId} className="sm:col-span-2">
          <Select value={f.agencyId} onChange={(e) => set("agencyId", e.target.value)} disabled={!!agencyId} invalid={!!errors.agencyId}>
            <option value="">Choose agency</option>
            {options.agencies.map((a) => <option key={a.id} value={a.id}>{a.agencyName}{a.agentCode ? ` (${a.agentCode})` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Method" required><Select value={f.method} onChange={(e) => set("method", e.target.value)}>{options.methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
        <Field label="Received into" hint="Needed before verification" error={errors.bankAccountId}>
          <Select value={f.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
            <option value="">Choose account</option>
            {options.banks.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label={`Amount (${options.currency})`} required error={errors.amount}><Input type="number" min={1} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} invalid={!!errors.amount} /></Field>
        <Field label="Date received" required error={errors.paidOn}><Input type="date" max={todayIso()} value={f.paidOn} onChange={(e) => set("paidOn", e.target.value)} /></Field>
        <Field label="Reference / receipt number"><Input value={f.transactionRef} onChange={(e) => set("transactionRef", e.target.value)} /></Field>
        <Field label="Receipt files (optional)"><Input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" /></Field>
      </form>
    </Modal>
  );
}

interface EntryDetail {
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
  bookingId: string | null;
  bookingReference: string | null;
  paymentId: string | null;
  paymentReference: string | null;
  requestReference: string | null;
  reversalOfId: string | null;
  reversalOfNumber: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  createdAt: string;
  lines: { id: string; accountCode: string; accountName: string; agencyId: string | null; debit: number; credit: number; description: string | null }[];
  reversedBy: { id: string; entryNumber: string } | null;
  pendingReversal: string | null;
}

/** One journal entry with its lines; Finance can ask for a reversal. */
export function JournalEntryModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const canManage = useCan("finance.manage");
  const { data: e, reload } = useApi<EntryDetail>(`/admin/finance/journal/${id}`);
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const requestReversal = async () => {
    setSaving(true);
    try {
      const res = await api.post("/admin/finance/requests", { kind: "reversal", reversalOfEntryId: id, reason });
      toast("success", res.message ?? "Sent for approval");
      setReversing(false);
      void reload();
      onChanged?.();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={e ? `Journal entry ${e.entryNumber}` : "Journal entry"} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {!e ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{e.typeLabel}</Badge>
            <span className="text-slate-500">{formatDate(e.entryDate)}</span>
            {e.reversedBy && <Badge tone="slate">Reversed by {e.reversedBy.entryNumber}</Badge>}
            {e.reversalOfNumber && <Badge tone="slate">Reverses {e.reversalOfNumber}</Badge>}
          </div>
          <p className="font-medium text-slate-900">{e.description}</p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {e.agencyName && <div><dt className="text-slate-500">Agency</dt><dd><Link className="text-brand-700 hover:underline" to={`/admin/finance/agencies/${e.agencyId}`}>{e.agencyName}</Link> {e.agentCode}</dd></div>}
            {e.bookingReference && <div><dt className="text-slate-500">Booking</dt><dd><Link className="text-brand-700 hover:underline" to={`/admin/bookings/${e.bookingId}`}>{e.bookingReference}</Link></dd></div>}
            {e.paymentReference && <div><dt className="text-slate-500">Payment</dt><dd><Link className="text-brand-700 hover:underline" to={`/admin/finance/payments/${e.paymentId}`}>{e.paymentReference}</Link></dd></div>}
            {e.requestReference && <div><dt className="text-slate-500">Request</dt><dd>{e.requestReference}</dd></div>}
            <div><dt className="text-slate-500">Posted by</dt><dd>{e.createdByName ?? "System"}{e.approvedByName ? `, approved by ${e.approvedByName}` : ""}</dd></div>
            <div><dt className="text-slate-500">Recorded</dt><dd>{formatDateTime(e.createdAt)}</dd></div>
          </dl>
          <table className="min-w-full">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2"><span className="font-mono text-xs text-slate-400">{l.accountCode}</span> {l.accountName}{l.agencyId && e.agencyName ? <span className="text-xs text-slate-500"> · {e.agencyName}</span> : null}</td>
                  <td className="px-3 py-2 text-right">{l.debit ? money(l.debit, e.currency) : ""}</td>
                  <td className="px-3 py-2 text-right">{l.credit ? money(l.credit, e.currency) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {e.pendingReversal && <Alert tone="warning">A reversal ({e.pendingReversal}) is waiting for approval.</Alert>}
          {canManage && !e.reversedBy && !e.pendingReversal && e.type !== "reversal" && (
            reversing ? (
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <Field label="Why should this entry be reversed?" required hint="A second finance user approves the reversal. The original entry stays in the ledger."><Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
                <div className="flex gap-2"><Button variant="secondary" onClick={() => setReversing(false)}>Cancel</Button><Button variant="danger" loading={saving} disabled={reason.trim().length < 5} onClick={requestReversal}>Request reversal</Button></div>
              </div>
            ) : <Button variant="secondary" icon={RotateCcw} onClick={() => setReversing(true)}>Reverse this entry</Button>
          )}
        </div>
      )}
    </Modal>
  );
}
