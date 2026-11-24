import { ArrowLeft, Banknote, Receipt, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useToast } from "../../../components/Toast";
import { PdfButton } from "../../../components/DocumentButtons";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Spinner } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { formatDate } from "../../../utils/format";
import { CreditStats, CsvButton, DateRange, PaymentStatusBadge, StatementTable, defaultRange, money } from "../../finance/shared";
import type { CreditInfo, PaymentRow, Statement } from "../../finance/types";
import { RequestList } from "./Finance";
import { JournalEntryModal, RecordPaymentModal, useFinanceOptions } from "./modals";

interface AgencyFinance {
  agency: { id: string; agencyName: string; agentCode: string | null; city: string; status: string; email: string; phone: string };
  credit: CreditInfo;
  pendingPayments: PaymentRow[];
}

export function AgencyLedger() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canManage = useCan("finance.manage");
  const { data, loading, error, reload } = useApi<AgencyFinance>(`/admin/finance/agencies/${id}`);
  const [range, setRange] = useState(defaultRange());
  const statement = useApi<Statement>(`/admin/finance/agencies/${id}/statement`, range);
  const { data: opts } = useFinanceOptions();
  const [recording, setRecording] = useState(false);
  const [entry, setEntry] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;
  const a = data.agency;
  const refresh = () => { void reload(); void statement.reload(); };

  return (
    <div className="space-y-6">
      <Link to="/admin/finance" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft className="size-4" /> Finance</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{a.agencyName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {a.agentCode} · {a.city} · {a.phone} · <Link to={`/admin/agencies/${a.id}`} className="text-brand-700 hover:underline">Agency profile</Link>
          </p>
        </div>
        {canManage && opts && <Button icon={Banknote} onClick={() => setRecording(true)}>Record payment</Button>}
      </div>

      <CreditStats credit={data.credit} forAgent={false} />

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="space-y-6 2xl:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader icon={Receipt} title="Statement" actions={statement.data && <div className="flex gap-2"><PdfButton path={`/admin/documents/agencies/${a.id}/statement?from=${range.from}&to=${range.to}`} label="PDF" /><CsvButton s={statement.data} title={`Statement: ${a.agencyName} (${a.agentCode ?? ""})`} /></div>} />
            <div className="border-b border-slate-100 p-4"><DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /></div>
            {statement.loading && !statement.data ? <Spinner /> : statement.error ? <Alert tone="error" className="m-4">{statement.error}</Alert> : statement.data && <StatementTable s={statement.data} bookingLink={(bid) => `/admin/bookings/${bid}`} onEntry={setEntry} documentPath={(eid) => `/admin/documents/entries/${eid}`} />}
          </Card>
          <RequestList agencyId={a.id} onChanged={refresh} />
        </div>
        <div className="space-y-6">
          <CreditTerms agencyId={a.id} credit={data.credit} canEdit={canManage} onSaved={refresh} />
          <Card>
            <CardHeader icon={Banknote} title="Payments to verify" />
            {data.pendingPayments.length === 0 ? <p className="p-5 text-sm text-slate-500">None.</p> : (
              <ul className="divide-y divide-slate-100">
                {data.pendingPayments.map((p) => (
                  <li key={p.id} className="flex cursor-pointer items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50" onClick={() => navigate(`/admin/finance/payments/${p.id}`)}>
                    <span className="flex-1"><span className="font-mono text-xs text-brand-700">{p.reference}</span><span className="block text-xs text-slate-500">{formatDate(p.paidOn)}</span></span>
                    <span className="font-medium">{money(p.amount, p.currency)}</span>
                    <PaymentStatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {recording && opts && <RecordPaymentModal options={opts} agencyId={a.id} onClose={() => setRecording(false)} onDone={(pid) => { setRecording(false); navigate(`/admin/finance/payments/${pid}`); }} />}
      {entry && <JournalEntryModal id={entry} onClose={() => setEntry(null)} onChanged={refresh} />}
    </div>
  );
}

function CreditTerms({ agencyId, credit, canEdit, onSaved }: { agencyId: string; credit: CreditInfo; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const initial = () => ({ paymentTerms: credit.paymentTerms, creditLimit: String(credit.creditLimit), creditPolicy: credit.creditPolicy, paymentTermsDays: String(credit.paymentTermsDays) });
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(initial()), [credit.paymentTerms, credit.creditLimit, credit.creditPolicy, credit.paymentTermsDays]);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const res = await api.put(`/admin/finance/agencies/${agencyId}/credit`, { ...f, creditLimit: Number(f.creditLimit) || 0, paymentTermsDays: Number(f.paymentTermsDays) || 0 });
      toast("success", res.message ?? "Saved");
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={SlidersHorizontal} title="Credit terms" description="Checked when Operations confirms a booking." />
      <div className="space-y-4 p-5">
        <Field label="Payment terms">
          <Select value={f.paymentTerms} disabled={!canEdit} onChange={(e) => setF({ ...f, paymentTerms: e.target.value as "advance" | "credit" })}>
            <option value="advance">Advance: bookings need payment received first</option>
            <option value="credit">Credit: may owe up to a limit</option>
          </Select>
        </Field>
        {f.paymentTerms === "credit" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Credit limit (${credit.currency})`} error={errors.creditLimit}><Input type="number" min={0} value={f.creditLimit} disabled={!canEdit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} /></Field>
            <Field label="Days to pay" error={errors.paymentTermsDays}><Input type="number" min={0} max={365} value={f.paymentTermsDays} disabled={!canEdit} onChange={(e) => setF({ ...f, paymentTermsDays: e.target.value })} /></Field>
          </div>
        )}
        <Field label="When a booking goes over" hint="Finance can always confirm over the limit with a reason.">
          <Select value={f.creditPolicy} disabled={!canEdit} onChange={(e) => setF({ ...f, creditPolicy: e.target.value as "warn" | "block" })}>
            <option value="block">Block confirmation</option>
            <option value="warn">Allow, with a warning in the history</option>
          </Select>
        </Field>
        {canEdit && <Button icon={Save} loading={saving} onClick={save}>Save terms</Button>}
        {!canEdit && <p className="text-xs text-slate-500">Only Finance can change credit terms.</p>}
      </div>
    </Card>
  );
}
