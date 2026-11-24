import { AlertTriangle, Banknote, Landmark, Receipt, Send, Wallet } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { PdfButton } from "../../../components/DocumentButtons";
import { useToast } from "../../../components/Toast";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, Textarea } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { formatDate, formatDateTime } from "../../../utils/format";
import { AttachmentList, CreditStats, CsvButton, DateRange, PaymentStatusBadge, StatementTable, defaultRange, money, todayIso } from "../../finance/shared";
import type { BankOption, CreditInfo, PaymentDetail, PaymentRow, Statement } from "../../finance/types";

interface Summary {
  credit: CreditInfo;
  banks: BankOption[];
  awaitingPayment: { id: string; reference: string; packageName: string; totalAmount: number; currency: string; status: string; holdExpiresAt: string | null }[];
  methods: { value: string; label: string }[];
}

export function AgentLedger() {
  const [params, setParams] = useSearchParams();
  const { data: sum, loading, error, reload: reloadSummary } = useApi<Summary>("/agent/finance/summary");
  const [page, setPage] = useState(1);
  const payments = useApi<{ items: PaymentRow[]; total: number; page: number; pageSize: number }>("/agent/finance/payments", { page, pageSize: 10 });
  const [range, setRange] = useState(defaultRange());
  const statement = useApi<Statement>("/agent/finance/statement", range);
  const [paying, setPaying] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  // "Pay now" from a booking opens the form for that booking.
  useEffect(() => {
    const b = params.get("booking");
    if (b) {
      setPaying(b);
      params.delete("booking");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  if (loading && !sum) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!sum) return null;
  const c = sum.credit;
  const refresh = () => { void reloadSummary(); void payments.reload(); void statement.reload(); };

  return (
    <div className="space-y-6">
      <PageHeader title="Ledger & payments" description="Your account with us: balance, payments and statement." actions={<Button icon={Send} onClick={() => setPaying("")}>Submit a payment</Button>} />
      <CreditStats credit={c} forAgent />

      {sum.awaitingPayment.length > 0 && (
        <Alert tone="warning" icon={AlertTriangle} title="Bookings waiting for payment">
          <ul className="mt-1 space-y-1">
            {sum.awaitingPayment.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2">
                <Link to={`/agent/bookings/${b.id}`} className="font-mono font-medium hover:underline">{b.reference}</Link>
                <span>{b.packageName} · {money(b.totalAmount, b.currency)}</span>
                {b.status === "awaiting_payment" ? (
                  <><span className="text-xs">{b.holdExpiresAt ? `seats held until ${formatDateTime(b.holdExpiresAt)}` : ""}</span><Button size="sm" onClick={() => setPaying(b.id)}>Pay now</Button></>
                ) : <span className="text-xs">payment received, being verified</span>}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="space-y-6 2xl:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader icon={Receipt} title="Statement" description="Every booking charge, payment and adjustment on your account." actions={statement.data && <div className="flex gap-2"><PdfButton path={`/agent/documents/statement?from=${range.from}&to=${range.to}`} label="PDF" /><CsvButton s={statement.data} title="Account statement" /></div>} />
            <div className="border-b border-slate-100 p-4"><DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /></div>
            {statement.loading && !statement.data ? <Spinner /> : statement.error ? <Alert tone="error" className="m-4">{statement.error}</Alert> : statement.data && <StatementTable s={statement.data} bookingLink={(id) => `/agent/bookings/${id}`} documentPath={(entryId) => `/agent/documents/entries/${entryId}`} />}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader icon={Wallet} title="My payments" description="Payments reach your balance once our finance team verifies them." />
            {!payments.data ? <Spinner /> : payments.data.items.length === 0 ? <EmptyState icon={Banknote} title="No payments yet" /> : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Paid on</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">For</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.data.items.map((p) => (
                        <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setViewing(p.id)}>
                          <td className="px-4 py-3 font-mono text-xs text-brand-700">{p.reference}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(p.paidOn)}</td>
                          <td className="px-4 py-3 text-slate-600">{p.methodLabel}{p.transactionRef ? <span className="block text-xs text-slate-400">{p.transactionRef}</span> : null}</td>
                          <td className="px-4 py-3 text-slate-600">{p.bookingReference ?? "On account"}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap font-medium">{money(p.amount, p.currency)}</td>
                          <td className="px-4 py-3"><PaymentStatusBadge status={p.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={payments.data.page} pageSize={payments.data.pageSize} total={payments.data.total} onPage={setPage} />
              </>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader icon={Landmark} title="Pay into" description="Use your agency code or booking reference as the payment reference." />
          {sum.banks.length === 0 ? <p className="p-5 text-sm text-slate-500">Bank details will appear here. Please contact us for payment details.</p> : (
            <ul className="divide-y divide-slate-100">
              {sum.banks.map((b) => (
                <li key={b.id} className="p-5">
                  <p className="font-semibold text-slate-900">{b.name}</p>
                  {b.bankDetails && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{b.bankDetails}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {paying !== null && <PaymentModal summary={sum} bookingId={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); refresh(); }} />}
      {viewing && <PaymentView id={viewing} onClose={() => setViewing(null)} onChanged={refresh} />}
    </div>
  );
}

function PaymentModal({ summary, bookingId, onClose, onDone }: { summary: Summary; bookingId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const booking = summary.awaitingPayment.find((b) => b.id === bookingId);
  const [f, setF] = useState({
    method: "bank_transfer",
    bankAccountId: summary.banks.length === 1 ? summary.banks[0]!.id : "",
    amount: booking ? String(booking.totalAmount) : "",
    paidOn: todayIso(),
    transactionRef: "",
    bookingId: booking?.id ?? "",
    notes: "",
  });
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
      const res = await api.postForm("/agent/finance/payments", fd);
      toast("success", res.message ?? "Payment submitted");
      onDone();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Submit a payment" description="Tell us about money you have paid. Your balance is updated once our finance team verifies it."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="pay-form" loading={saving}>Submit payment</Button></>}>
      <form id="pay-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Method" required error={errors.method}>
          <Select value={f.method} onChange={(e) => set("method", e.target.value)}>{summary.methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select>
        </Field>
        <Field label="Paid into" required={["bank_transfer", "cash_deposit", "cheque"].includes(f.method)} error={errors.bankAccountId}>
          <Select value={f.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)} invalid={!!errors.bankAccountId}>
            <option value="">Choose account</option>
            {summary.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label={`Amount (${summary.credit.currency})`} required error={errors.amount}><Input type="number" min={1} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} invalid={!!errors.amount} /></Field>
        <Field label="Date paid" required error={errors.paidOn}><Input type="date" max={todayIso()} value={f.paidOn} onChange={(e) => set("paidOn", e.target.value)} invalid={!!errors.paidOn} /></Field>
        <Field label="Transaction / slip number" error={errors.transactionRef}><Input value={f.transactionRef} onChange={(e) => set("transactionRef", e.target.value)} /></Field>
        <Field label="For booking" hint="Leave as 'On account' for a general deposit" error={errors.bookingId}>
          <Select value={f.bookingId} onChange={(e) => set("bookingId", e.target.value)}>
            <option value="">On account</option>
            {summary.awaitingPayment.filter((b) => b.status === "awaiting_payment").map((b) => <option key={b.id} value={b.id}>{b.reference} · {money(b.totalAmount, b.currency)}</option>)}
          </Select>
        </Field>
        <Field label="Receipt / deposit slip (PDF, JPG or PNG, up to 3 files)" required={["bank_transfer", "cash_deposit", "cheque"].includes(f.method)} error={errors.files} className="sm:col-span-2">
          <Input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} invalid={!!errors.files} />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" /></Field>
      </form>
    </Modal>
  );
}

function PaymentView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: p, setData } = useApi<PaymentDetail>(`/agent/finance/payments/${id}`);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const reply = async () => {
    const fd = new FormData();
    fd.append("note", note);
    files.forEach((f) => fd.append("files", f));
    setSaving(true);
    try {
      const res = await api.postForm<PaymentDetail>(`/agent/finance/payments/${id}/reply`, fd);
      setData(res.data);
      setNote("");
      setFiles([]);
      toast("success", res.message ?? "Sent");
      onChanged();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={p ? `Payment ${p.reference}` : "Payment"} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {!p ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-bold text-slate-900">{money(p.amount, p.currency)}</span>
            <PaymentStatusBadge status={p.status} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Method</dt><dd>{p.methodLabel}</dd></div>
            <div><dt className="text-slate-500">Paid on</dt><dd>{formatDate(p.paidOn)}</dd></div>
            <div><dt className="text-slate-500">Paid into</dt><dd>{p.bankName ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Reference</dt><dd>{p.transactionRef ?? "—"}</dd></div>
            <div><dt className="text-slate-500">For</dt><dd>{p.bookingReference ?? "On account"}</dd></div>
            <div><dt className="text-slate-500">Submitted</dt><dd>{formatDateTime(p.createdAt)}</dd></div>
          </dl>
          {p.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{p.notes}</p>}
          {p.reviewNote && <Alert tone={p.status === "clarification" ? "warning" : "error"} title={p.status === "clarification" ? "Our finance team needs more information" : "Note from our finance team"}>{p.reviewNote}</Alert>}
          {(p.status === "verified" || p.status === "reversed") && <PdfButton path={`/agent/documents/payments/${p.id}/receipt`} label="Payment receipt (PDF)" />}
          <div><p className="mb-2 text-sm font-medium text-slate-700">Receipts</p><AttachmentList files={p.attachments} basePath={`/agent/finance/payments/${p.id}/attachments`} /></div>
          {p.status === "clarification" && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <Field label="Your reply" required><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <Field label="Add receipts (optional)"><Input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} /></Field>
              <Button icon={Send} loading={saving} disabled={note.trim().length < 3} onClick={reply}>Send reply</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
