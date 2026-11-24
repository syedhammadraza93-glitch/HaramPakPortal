import { ArrowLeft, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { PdfButton } from "../../../components/DocumentButtons";
import { Alert, Button, Card, CardHeader, Detail, Field, Input, Select, Spinner, Textarea } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage } from "../../../utils/api";
import { formatDate, formatDateTime } from "../../../utils/format";
import { AttachmentList, PaymentStatusBadge, money, todayIso } from "../../finance/shared";
import type { PaymentDetail as Payment } from "../../finance/types";
import { JournalEntryModal, useFinanceOptions } from "./modals";

export function PaymentDetail() {
  const { id } = useParams();
  const toast = useToast();
  const canManage = useCan("finance.manage");
  const { data: p, loading, error, setData } = useApi<Payment>(`/admin/finance/payments/${id}`);
  const { data: opts } = useFinanceOptions();
  const [verify, setVerify] = useState({ bankAccountId: "", entryDate: "", note: "" });
  const [review, setReview] = useState<"reject" | "clarify" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState(false);

  if (loading && !p) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!p) return null;
  const open = ["pending", "clarification"].includes(p.status);

  const run = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      const res = await api.post<Payment>(path, body);
      setData({ ...res.data, canVerify: false });
      toast("success", res.message ?? "Done");
      return true;
    } catch (err) {
      toast("error", errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/admin/finance?tab=payments" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft className="size-4" /> Payments</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold text-slate-900">{p.reference}</h1>
        <PaymentStatusBadge status={p.status} />
        <span className="text-2xl font-bold text-brand-700">{money(p.amount, p.currency)}</span>
        {(p.status === "verified" || p.status === "reversed") && <PdfButton path={`/admin/documents/payments/${p.id}/receipt`} label="Receipt (PDF)" />}
      </div>

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="space-y-6 2xl:col-span-2">
          <Card>
            <CardHeader title="Payment" />
            <dl className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Agency"><Link to={`/admin/finance/agencies/${p.agencyId}`} className="text-brand-700 hover:underline">{p.agencyName}</Link> {p.agentCode}</Detail>
              <Detail label="Method">{p.methodLabel}</Detail>
              <Detail label="Paid on">{formatDate(p.paidOn)}</Detail>
              <Detail label="Paid into">{p.bankName ?? "Not given"}</Detail>
              <Detail label="Transaction / slip no.">{p.transactionRef ?? ""}</Detail>
              <Detail label="For">{p.bookingId ? <Link to={`/admin/bookings/${p.bookingId}`} className="text-brand-700 hover:underline">{p.bookingReference}</Link> : "On account"}</Detail>
              <Detail label="Submitted by">{`${p.submittedByName ?? ""} (${p.submittedByType === "staff" ? "staff" : "agent"}) · ${formatDateTime(p.createdAt)}`}</Detail>
              {p.reviewedByName && <Detail label="Reviewed by">{`${p.reviewedByName} · ${formatDateTime(p.reviewedAt)}`}</Detail>}
              {p.entryNumber && <Detail label="Ledger entry"><button className="font-mono text-brand-700 hover:underline" onClick={() => setEntry(true)}>{p.entryNumber}</button></Detail>}
            </dl>
            {p.notes && <p className="mx-5 mb-5 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{p.notes}</p>}
            {p.reviewNote && <Alert tone={p.status === "verified" ? "info" : "warning"} className="mx-5 mb-5">{p.reviewNote}</Alert>}
          </Card>
          <Card>
            <CardHeader title="Receipts" description="Check the amount, date and bank against the bank statement before verifying." />
            <div className="p-5"><AttachmentList files={p.attachments} basePath={`/admin/finance/payments/${p.id}/attachments`} /></div>
          </Card>
        </div>

        {canManage && open && (
          <Card>
            <CardHeader icon={CheckCircle2} title="Verify" description="Posts the payment to the agency's account. It cannot be edited afterwards, only reversed." />
            <div className="space-y-4 p-5">
              {!p.canVerify && p.submittedByType === "staff" && <Alert tone="warning">You recorded this payment. A different finance user must verify it.</Alert>}
              <Field label="Received into" hint={p.bankName ? `Agent said: ${p.bankName}` : "Required"}>
                <Select value={verify.bankAccountId || p.bankAccountId || ""} onChange={(e) => setVerify({ ...verify, bankAccountId: e.target.value })}>
                  <option value="">Choose account</option>
                  {opts?.banks.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Entry date" hint="Leave empty for today"><Input type="date" max={todayIso()} value={verify.entryDate} onChange={(e) => setVerify({ ...verify, entryDate: e.target.value })} /></Field>
              <Field label="Note (optional)"><Textarea value={verify.note} onChange={(e) => setVerify({ ...verify, note: e.target.value })} className="min-h-16" /></Field>
              <div className="flex flex-wrap gap-2">
                <Button icon={CheckCircle2} loading={busy} disabled={!p.canVerify || !(verify.bankAccountId || p.bankAccountId)} onClick={() => run(`/admin/finance/payments/${p.id}/verify`, { bankAccountId: verify.bankAccountId || p.bankAccountId, entryDate: verify.entryDate || null, note: verify.note || null })}>Verify payment</Button>
                <Button variant="secondary" icon={HelpCircle} onClick={() => { setReview("clarify"); setNote(""); }}>Ask the agent</Button>
                <Button variant="danger" icon={XCircle} onClick={() => { setReview("reject"); setNote(""); }}>Not received</Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      <Modal open={!!review} onClose={() => setReview(null)} title={review === "reject" ? "Reject payment" : "Ask the agent for more information"}
        footer={<><Button variant="secondary" onClick={() => setReview(null)}>Cancel</Button><Button variant={review === "reject" ? "danger" : "primary"} loading={busy} disabled={note.trim().length < 3} onClick={async () => { if (await run(`/admin/finance/payments/${p.id}/${review === "reject" ? "reject" : "clarify"}`, { note })) setReview(null); }}>{review === "reject" ? "Reject" : "Send question"}</Button></>}>
        <Field label={review === "reject" ? "Reason (sent to the agent)" : "Question (sent to the agent)"} required><Textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
      </Modal>
      {entry && p.journalEntryId && <JournalEntryModal id={p.journalEntryId} onClose={() => setEntry(false)} />}
    </div>
  );
}
