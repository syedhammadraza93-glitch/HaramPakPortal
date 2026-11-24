import { ArrowLeft, CheckCircle2, ExternalLink, FilePlus2, FileText, ListChecks, Plus, Receipt, Trash2, Users, Wallet, XCircle } from "lucide-react";
import { useCan } from "../../../redux/hooks";
import { BookingFinanceCard } from "../finance/BookingFinanceCard";
import { BookingDocumentsCard } from "../../../components/DocumentButtons";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Detail, EmptyState, Field, Input, Select, Spinner, Textarea } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { api, errorMessage, fieldErrors, type Envelope } from "../../../utils/api";
import { DOC_REVIEW, PAX_TYPES, ROOM_TYPES, VERTICALS, formatBytes, formatDate, formatDateTime, formatMoney } from "../../../utils/format";
import { BookingStatusBadge, HistoryCard, MessagesCard, PriceTable, holdLeft } from "../../bookings/shared";
import type { BookingDetail as BookingData } from "../../bookings/types";

const DANGER = new Set(["reject", "cancel"]);

export function BookingDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data: b, loading, error, setData } = useApi<BookingData>(`/admin/bookings/${id}`);
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [rejectDoc, setRejectDoc] = useState<string | null>(null);
  const [docNote, setDocNote] = useState("");
  const [overrideCredit, setOverrideCredit] = useState(false);
  const canSeeFinance = useCan("finance.view");

  if (loading && !b) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!b) return null;
  const rules = b.actionRules ?? {};

  /** Runs a request that returns the updated booking. */
  const run = async (fn: () => Promise<Envelope<BookingData>>) => {
    setBusy(true);
    try {
      const res = await fn();
      setData(res.data);
      toast("success", res.message ?? "Done");
      return true;
    } catch (err) {
      toast("error", errorMessage(err));
      const fe = fieldErrors(err);
      if (fe.reason) setReasonError(fe.reason);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const doAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!action) return;
    if (rules[action]?.reasonRequired && reason.trim().length < 3) return setReasonError("Please enter a reason (at least 3 characters)");
    if (action === "confirm" && overrideCredit && reason.trim().length < 5) return setReasonError("Give the reason for the credit override (at least 5 characters)");
    if (await run(() => api.post(`/admin/bookings/${b.id}/status/${action}`, { reason, overrideCredit: action === "confirm" && overrideCredit }))) setAction(null);
  };

  const openFile = (docId: string) => api.openFile(`/admin/bookings/${b.id}/documents/${docId}`).catch((e) => toast("error", errorMessage(e)));
  const hold = ["submitted", "under_review", "information_required"].includes(b.status) ? holdLeft(b.holdExpiresAt) : null;
  const agentDocs = b.documents.filter((d) => !d.issued);
  const issuedDocs = b.documents.filter((d) => d.issued);

  return (
    <div className="space-y-6">
      <Link to="/admin/bookings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft className="size-4" /> Bookings</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-bold text-slate-900">{b.reference}</h1>
            <BookingStatusBadge status={b.status} />
            {b.isQuotation && <Badge tone="blue">Quotation request</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <Link to={`/admin/agencies/${b.agency.id}`} className="font-medium text-brand-700 hover:underline">{b.agency.name}</Link>
            {b.agency.agentCode && ` (${b.agency.agentCode})`} · {b.agency.phone} · submitted {formatDateTime(b.submittedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {b.allowedActions.includes("send-quotation") && <Button icon={Receipt} onClick={() => setQuoting(true)}>Send quotation</Button>}
          {b.allowedActions.filter((a) => a !== "send-quotation").map((a) => (
            <Button key={a} variant={DANGER.has(a) ? "danger" : a === "confirm" ? "primary" : "secondary"} onClick={() => { setAction(a); setReason(""); setReasonError(undefined); setOverrideCredit(false); }}>
              {rules[a]?.label ?? a}
            </Button>
          ))}
        </div>
      </div>

      {hold && <Alert tone={hold === "expired" ? "error" : "warning"}>Seats held for this booking: {b.seatsHeld}. {hold === "expired" ? "The hold has expired and will be released." : `Hold ends in ${hold} unless confirmed.`}</Alert>}
      {b.credit && <CreditAlert credit={b.credit} />}
      {b.status === "cancelled" && b.cancellationCharge !== null && (
        <Alert tone="info">Cancelled{b.cancelReason ? `: ${b.cancelReason}` : ""}. Cancellation charge under the package policy: <b>{formatMoney(b.cancellationCharge, b.currency)}</b>. The rest goes back to the agency as a credit note once Finance approves it.</Alert>
      )}

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="space-y-6 2xl:col-span-2">
          <Card>
            <CardHeader title="Trip" />
            <dl className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Package"><Link to={`/admin/packages/${b.packageId}`} className="text-brand-700 hover:underline">{b.packageName}</Link> <span className="text-xs text-slate-400">{b.packageCode}</span></Detail>
              <Detail label="Product type">{VERTICALS[b.vertical]}</Detail>
              <Detail label="Departure">{b.isQuotation ? b.requestedDates ?? "" : `${formatDate(b.departureDate)} – ${formatDate(b.returnDate)}`}</Detail>
              <Detail label="Seats left on departure">{b.departure ? (b.departure.seatsLeft === null ? "Not limited" : String(b.departure.seatsLeft)) : "—"}</Detail>
              <Detail label="Passengers">{String(b.paxCount)}</Detail>
              <Detail label="Agency reference">{b.agentReference ?? ""}</Detail>
              <Detail label="Total">{b.totalAmount ? formatMoney(b.totalAmount, b.currency) : "—"}</Detail>
              {b.quoteValidUntil && <Detail label="Quotation valid until">{formatDate(b.quoteValidUntil)}</Detail>}
              {b.agentNotes && <div className="sm:col-span-2 lg:col-span-4"><Detail label="Agent notes">{b.agentNotes}</Detail></div>}
            </dl>
          </Card>

          <Card>
            <CardHeader icon={Users} title="Passengers & documents" description="Open each document and verify it, or reject it with a note for the agent." />
            {b.passengers.length === 0 ? <EmptyState icon={Users} title="No passengers" /> : (
              <div className="divide-y divide-slate-100">
                {b.passengers.map((p, i) => {
                  const docs = agentDocs.filter((d) => d.passengerId === p.id);
                  return (
                    <div key={p.id} className="space-y-3 p-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold text-slate-900">{i + 1}. {p.fullName}</p>
                        <p className="text-sm text-slate-500">{PAX_TYPES[p.paxType]}{p.roomType ? ` · ${ROOM_TYPES[p.roomType]} room` : ""}</p>
                      </div>
                      <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                        <Detail label="Gender">{p.gender ?? ""}</Detail>
                        <Detail label="Date of birth">{formatDate(p.dateOfBirth)}</Detail>
                        <Detail label="Nationality">{p.nationality ?? ""}</Detail>
                        <Detail label="Passport">{p.passportNumber ?? ""}</Detail>
                        <Detail label="Issued">{formatDate(p.passportIssueDate)}</Detail>
                        <Detail label="Expires">{formatDate(p.passportExpiryDate)}</Detail>
                      </dl>
                      {docs.length > 0 && (
                        <ul className="space-y-2">
                          {docs.map((d) => (
                            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                              <FileText className="size-4 text-brand-600" />
                              <span className="min-w-0 flex-1 truncate">{d.name} <span className="text-xs text-slate-400">· {d.fileName} · {formatBytes(d.sizeBytes)}</span></span>
                              <Badge tone={DOC_REVIEW[d.status]?.tone}>{DOC_REVIEW[d.status]?.label}</Badge>
                              {d.reviewNote && <span className="text-xs text-accent-600">{d.reviewNote}</span>}
                              <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => openFile(d.id)}>Open</Button>
                              {b.canManage && d.status !== "verified" && <Button size="sm" variant="ghost" icon={CheckCircle2} onClick={() => run(() => api.patch(`/admin/bookings/${b.id}/documents/${d.id}`, { status: "verified" }))}>Verify</Button>}
                              {b.canManage && d.status !== "rejected" && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => { setRejectDoc(d.id); setDocNote(""); }}>Reject</Button>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader icon={Receipt} title="Price" description={b.status === "submitted" || b.isQuotation ? undefined : "Frozen when the booking was submitted."} />
            <div className="p-5"><PriceTable lines={b.priceLines} currency={b.currency} total={b.totalAmount} /></div>
          </Card>

          <Card>
            <CardHeader icon={FilePlus2} title="Travel documents for the agent" description="Vouchers, visas, tickets. The agent can download them." actions={b.canManage && ["confirmed", "processing", "documents_issued", "completed"].includes(b.status) && <Button size="sm" icon={Plus} onClick={() => setIssuing(true)}>Add document</Button>} />
            {issuedDocs.length === 0 ? <p className="p-5 text-sm text-slate-500">None yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {issuedDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <FileText className="size-4 text-brand-600" />
                    <span className="flex-1">{d.name}{d.passengerId && <span className="text-slate-400"> · {b.passengers.find((p) => p.id === d.passengerId)?.fullName}</span>}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(d.createdAt)}</span>
                    <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => openFile(d.id)}>Open</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <BookingDocumentsCard basePath={`/admin/documents/bookings/${b.id}`} docs={b.documentsAvailable} />
          {canSeeFinance && b.status !== "draft" && <BookingFinanceCard bookingId={b.id} refreshKey={b.status} />}
          {b.stages.length > 0 && (
            <Card>
              <CardHeader icon={ListChecks} title="Progress" description="Steps for this product type (set up in Catalogue setup)." />
              <ul className="space-y-3 p-5">
                {b.stages.map((s) => (
                  <li key={s.id}>
                    <Checkbox
                      checked={s.done}
                      disabled={!b.canManage || busy}
                      onChange={(e) => run(() => api.put(`/admin/bookings/${b.id}/stages/${s.id}`, { done: e.target.checked }))}
                      label={<span><span className={s.done ? "text-slate-500 line-through" : "text-slate-800"}>{s.name}</span>{s.done && <span className="block text-xs text-slate-400">{s.completedByName} · {formatDateTime(s.completedAt)}</span>}</span>}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <MessagesCard
            messages={b.messages}
            staff
            canSend={!!b.canManage}
            onSend={(message, isInternal) => run(() => api.post(`/admin/bookings/${b.id}/messages`, { message, isInternal }))}
          />
          <HistoryCard history={b.history} />
        </div>
      </div>

      <Modal open={!!action} onClose={() => setAction(null)} title={action ? `${rules[action]?.label}: ${b.reference}` : ""}
        footer={<><Button variant="secondary" onClick={() => setAction(null)}>Close</Button><Button type="submit" form="booking-action" variant={action && DANGER.has(action) ? "danger" : "primary"} loading={busy}>{action ? rules[action]?.label : ""}</Button></>}>
        <form id="booking-action" onSubmit={doAction} className="space-y-3">
          {action === "confirm" && <p className="text-sm text-slate-600">The held seats become sold, {formatMoney(b.totalAmount, b.currency)} is charged to the agency's account, and the agent is emailed.</p>}
          {action === "confirm" && b.credit && !b.credit.check.withinCredit && (
            b.credit.check.policy === "warn"
              ? <Alert tone="warning">This booking is {formatMoney(b.credit.check.shortBy, b.currency)} over the agency's available credit. It will be confirmed with a warning in the history.</Alert>
              : b.credit.canOverride
                ? <Checkbox label={`Confirm over the credit limit (${formatMoney(b.credit.check.shortBy, b.currency)} short). The reason below is logged.`} checked={overrideCredit} onChange={(e) => setOverrideCredit(e.target.checked)} />
                : <Alert tone="error">This booking is {formatMoney(b.credit.check.shortBy, b.currency)} over the agency's available {b.credit.paymentTerms === "credit" ? "credit" : "balance"}. Use <b>Ask for payment</b>, or ask Finance to confirm it with an override.</Alert>
          )}
          {action === "await-payment" && <p className="text-sm text-slate-600">The agent is asked to pay {formatMoney(b.totalAmount, b.currency)}. Seats stay held until the hold ends. When Finance verifies the payment, the booking comes back here to confirm.</p>}
          {action === "cancel" && ["confirmed", "processing", "documents_issued"].includes(b.status) && <p className="text-sm text-slate-600">The cancellation charge under the package's policy is worked out. A credit note for the rest is sent to Finance for approval.</p>}
          <Field label={action === "request-info" ? "What do you need from the agent?" : "Reason / note"} required={!!action && rules[action]?.reasonRequired} error={reasonError} hint="Sent to the agent and kept in the history.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!reasonError} autoFocus />
          </Field>
        </form>
      </Modal>

      <QuotationModal open={quoting} booking={b} onClose={() => setQuoting(false)} onDone={(d) => { setData(d); setQuoting(false); }} />
      <IssueModal open={issuing} booking={b} onClose={() => setIssuing(false)} onDone={(d) => { setData(d); setIssuing(false); }} />

      <Modal open={!!rejectDoc} onClose={() => setRejectDoc(null)} title="Reject document"
        footer={<><Button variant="secondary" onClick={() => setRejectDoc(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={!docNote.trim()} onClick={async () => { if (await run(() => api.patch(`/admin/bookings/${b.id}/documents/${rejectDoc}`, { status: "rejected", note: docNote }))) setRejectDoc(null); }}>Reject</Button></>}>
        <Field label="Note for the agent" required><Textarea value={docNote} onChange={(e) => setDocNote(e.target.value)} placeholder="e.g. Photo is blurred, please upload a clear scan" autoFocus /></Field>
      </Modal>
    </div>
  );
}

/** Agency's credit position for a booking that can still be confirmed. */
function CreditAlert({ credit }: { credit: NonNullable<BookingData["credit"]> }) {
  const c = credit.check;
  const owes = credit.balance > 0 ? `owes ${formatMoney(credit.balance, credit.currency)}` : credit.balance < 0 ? `has ${formatMoney(-credit.balance, credit.currency)} in credit` : "has a zero balance";
  const terms = credit.paymentTerms === "credit" ? "Credit terms" : "Advance terms";
  if (c.withinCredit) return <Alert tone="success" icon={Wallet}>{terms}: the agency {owes}. Available {formatMoney(c.available, credit.currency)}, enough for this booking.</Alert>;
  return (
    <Alert tone={c.policy === "block" ? "error" : "warning"} icon={Wallet} title={`${formatMoney(c.shortBy, credit.currency)} over the available ${credit.paymentTerms === "credit" ? "credit" : "balance"}`}>
      {terms}: the agency {owes}; available {formatMoney(Math.max(0, c.available), credit.currency)}. {c.policy === "block" ? "Confirmation is blocked: ask for payment first, or Finance can override." : "Confirmation is allowed with a warning."}
    </Alert>
  );
}

function QuotationModal({ open, booking, onClose, onDone }: { open: boolean; booking: BookingData; onClose: () => void; onDone: (d: BookingData) => void }) {
  const toast = useToast();
  const [lines, setLines] = useState([{ description: booking.packageName, quantity: String(booking.paxCount || 1), unitAmount: "" }]);
  const [validUntil, setValidUntil] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const total = lines.reduce((s, l) => s + (Number(l.unitAmount) || 0) * (Number(l.quantity) || 0), 0);
  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post<BookingData>(`/admin/bookings/${booking.id}/quotation`, { lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, unitAmount: Number(l.unitAmount) || 0 })), validUntil, message });
      toast("success", res.message ?? "Sent");
      onDone(res.data);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const update = (i: number, k: "description" | "quantity" | "unitAmount", v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Send quotation" description={`Requested: ${booking.requestedDates ?? "—"} · ${booking.paxCount} passengers`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save} disabled={!validUntil || total <= 0}>Send to agent</Button></>}>
      <div className="space-y-4">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_140px_auto] items-end gap-2">
            <Field label={i === 0 ? "Description" : undefined}><Input value={l.description} onChange={(e) => update(i, "description", e.target.value)} /></Field>
            <Field label={i === 0 ? "Qty" : undefined}><Input type="number" min={1} value={l.quantity} onChange={(e) => update(i, "quantity", e.target.value)} /></Field>
            <Field label={i === 0 ? `Each (${booking.currency})` : undefined}><Input type="number" min={0} value={l.unitAmount} onChange={(e) => update(i, "unitAmount", e.target.value)} /></Field>
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label="Remove line" />
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setLines([...lines, { description: "", quantity: "1", unitAmount: "" }])}>Add line</Button>
        <p className="text-right text-lg font-bold text-brand-700">Total {formatMoney(total, booking.currency)}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valid until" required><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        </div>
        <Field label="Message to the agent"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-20" placeholder="Hotels, dates and anything the agent should know" /></Field>
      </div>
    </Modal>
  );
}

function IssueModal({ open, booking, onClose, onDone }: { open: boolean; booking: BookingData; onClose: () => void; onDone: (d: BookingData) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [passengerId, setPassengerId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("name", name);
    if (passengerId) fd.append("passengerId", passengerId);
    fd.append("file", file);
    setSaving(true);
    try {
      const res = await api.postForm<BookingData>(`/admin/bookings/${booking.id}/documents`, fd);
      toast("success", res.message ?? "Added");
      setName("");
      setFile(null);
      onDone(res.data);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add travel document" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save} disabled={!file || name.trim().length < 2}>Upload</Button></>}>
      <div className="space-y-4">
        <Field label="Document" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Umrah visa, Hotel voucher, E-ticket" /></Field>
        <Field label="For passenger" hint="Leave empty for the whole booking">
          <Select value={passengerId} onChange={(e) => setPassengerId(e.target.value)}>
            <option value="">Whole booking</option>
            {booking.passengers.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
        </Field>
        <Field label="File (PDF, JPG or PNG, max 5 MB)" required><Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
    </Modal>
  );
}
