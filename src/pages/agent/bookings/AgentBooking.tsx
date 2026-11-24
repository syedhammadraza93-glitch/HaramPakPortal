import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download, FileText, ListChecks, Plus, Receipt, Send, Trash2, Upload, Users, Wallet, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { BookingDocumentsCard } from "../../../components/DocumentButtons";
import { useToast } from "../../../components/Toast";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Spinner, Textarea, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { ApiError, api, errorMessage, type Envelope, type FieldError } from "../../../utils/api";
import { DOC_REVIEW, PAX_TYPES, ROOM_TYPES, VERTICALS, formatDate, formatDateTime, formatMoney } from "../../../utils/format";
import { BookingStatusBadge, HistoryCard, MessagesCard, PriceTable, holdLeft } from "../../bookings/shared";
import type { BookingDetail as BookingData, Passenger } from "../../bookings/types";

type PaxForm = Omit<Passenger, "id"> & { id?: string; key: number };
let nextKey = 1;
const blankPax = (): PaxForm => ({ key: nextKey++, fullName: "", gender: null, dateOfBirth: null, nationality: null, passportNumber: null, passportIssueDate: null, passportExpiryDate: null, paxType: "adult", roomType: null, phone: null, notes: null });

export function AgentBooking() {
  const { id } = useParams();
  const toast = useToast();
  const { data: b, loading, error, setData } = useApi<BookingData>(`/agent/bookings/${id}`);
  const [pax, setPax] = useState<PaxForm[]>([]);
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState({ agentReference: "", requestedDates: "", agentNotes: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<FieldError[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    if (!b) return;
    setPax(b.passengers.length ? b.passengers.map((p) => ({ ...p, key: nextKey++ })) : [blankPax()]);
    setAddons(Object.fromEntries(b.addons.map((a) => [a.addonId, a.quantity])));
    setMeta({ agentReference: b.agentReference ?? "", requestedDates: b.requestedDates ?? "", agentNotes: b.agentNotes ?? "" });
    setDirty(false);
  }, [b]);

  if (loading && !b) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!b) return null;

  const can = (a: string) => b.allowedActions.includes(a);
  const editable = can("edit");
  const hold = ["submitted", "under_review", "information_required"].includes(b.status) ? holdLeft(b.holdExpiresAt) : null;
  const lastReason = b.history.find((h) => h.toStatus === b.status)?.reason;

  const run = async (fn: () => Promise<Envelope<BookingData>>, opts: { quiet?: boolean } = {}) => {
    setBusy(true);
    try {
      const res = await fn();
      setData(res.data);
      if (!opts.quiet) toast("success", res.message ?? "Saved");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.errors?.length) setProblems(err.errors);
      toast("error", errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveBody = () => ({
    passengers: pax.filter((p) => p.fullName.trim()).map(({ key: _k, ...p }) => p),
    addons: Object.entries(addons).filter(([, q]) => q > 0).map(([addonId, quantity]) => ({ addonId, quantity })),
    ...meta,
  });
  const save = () => run(() => api.put(`/agent/bookings/${b.id}`, saveBody()));
  const submit = async () => {
    setProblems([]);
    if (dirty && !(await run(() => api.put(`/agent/bookings/${b.id}`, saveBody()), { quiet: true }))) return;
    await run(() => api.post(`/agent/bookings/${b.id}/${b.status === "information_required" ? "resubmit" : "submit"}`));
  };
  const upload = async (file: File | undefined, passengerId: string | null, requirementId: string | null, name?: string) => {
    if (!file) return;
    const fd = new FormData();
    if (passengerId) fd.append("passengerId", passengerId);
    if (requirementId) fd.append("requirementId", requirementId);
    if (name) fd.append("name", name);
    fd.append("file", file);
    await run(() => api.postForm(`/agent/bookings/${b.id}/documents`, fd));
  };
  const openDoc = (docId: string) => api.openFile(`/agent/bookings/${b.id}/documents/${docId}`).catch((e) => toast("error", errorMessage(e)));

  const updatePax = (key: number, patch: Partial<PaxForm>) => {
    setPax((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    setDirty(true);
  };
  const quote = b.liveQuote;
  const issued = b.documents.filter((d) => d.issued);

  return (
    <div className="space-y-6">
      <Link to="/agent/bookings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft className="size-4" /> My bookings</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{b.reference ? <span className="font-mono">{b.reference}</span> : "New booking"}</h1>
            <BookingStatusBadge status={b.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {b.packageName} · {VERTICALS[b.vertical]} · {b.isQuotation ? "quotation request" : `${formatDate(b.departureDate)} – ${formatDate(b.returnDate)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("accept-quotation") && <Button icon={CheckCircle2} loading={busy} onClick={() => run(() => api.post(`/agent/bookings/${b.id}/quotation/accept`))}>Accept quotation</Button>}
          {can("decline-quotation") && <Button variant="secondary" icon={XCircle} loading={busy} onClick={() => window.confirm("Decline this quotation?") && run(() => api.post(`/agent/bookings/${b.id}/quotation/decline`))}>Decline</Button>}
          {can("cancel") && <Button variant="ghost" icon={XCircle} onClick={() => { setCancelReason(""); setCancelling(true); }}>{b.status === "draft" ? "Discard draft" : "Cancel booking"}</Button>}
        </div>
      </div>

      {b.status === "information_required" && lastReason && <Alert tone="warning" icon={AlertTriangle} title="Our team needs more information">{lastReason}<p className="mt-1">Update the booking below and click <b>Resubmit</b>.</p></Alert>}
      {b.status === "quotation_sent" && <Alert tone="info" icon={Receipt} title="Quotation received">Total {formatMoney(b.totalAmount, b.currency)}{b.quoteValidUntil ? `, valid until ${formatDate(b.quoteValidUntil)}` : ""}. Accept it to go ahead, or send us a message.</Alert>}
      {hold && <Alert tone={hold === "expired" ? "error" : "info"} icon={Clock}>{b.seatsHeld} seat{b.seatsHeld === 1 ? " is" : "s are"} held for you{hold === "expired" ? " (hold expired)" : ` for ${hold} more while our team confirms the booking`}.</Alert>}
      {b.status === "awaiting_payment" && (
        <Alert tone="warning" icon={Wallet} title="Payment needed to confirm this booking">
          Please pay {formatMoney(b.totalAmount, b.currency)} and submit the payment details{b.holdExpiresAt ? ` before ${formatDateTime(b.holdExpiresAt)}, when the seats are released` : ""}.
          <div className="mt-2"><Link to={`/agent/ledger?booking=${b.id}`}><Button size="sm" icon={Wallet}>Pay now</Button></Link></div>
        </Alert>
      )}
      {b.status === "payment_pending_verification" && <Alert tone="info" icon={Wallet}>We have your payment and our finance team is verifying it. Your seats stay held meanwhile.</Alert>}
      {b.status === "cancelled" && <Alert tone="error">Cancelled{b.cancelReason ? `: ${b.cancelReason}` : ""}.{b.cancellationCharge ? ` Cancellation charge: ${formatMoney(b.cancellationCharge, b.currency)}. Any refund is credited to your account once approved.` : ""}</Alert>}
      {b.status === "refunded" && <Alert tone="info" icon={Wallet}>Cancelled and refunded to your account. See <Link to="/agent/ledger" className="font-medium underline">Ledger & payments</Link>.</Alert>}
      {problems.length > 0 && (
        <Alert tone="error" title="Please fix these before submitting">
          <ul className="list-inside list-disc">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
        </Alert>
      )}

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="space-y-6 2xl:col-span-2">
          <Card>
            <CardHeader icon={Users} title={`Passengers (${editable ? pax.filter((p) => p.fullName.trim()).length : b.passengers.length})`} description={editable ? "Names exactly as in the passport. Save, then upload each passenger's documents." : undefined}
              actions={editable && <Button size="sm" variant="secondary" icon={Plus} onClick={() => { setPax([...pax, blankPax()]); setDirty(true); }}>Add passenger</Button>} />
            <div className="divide-y divide-slate-100">
              {(editable ? pax : b.passengers.map((p) => ({ ...p, key: 0 }))).map((p, i) => {
                const saved = b.passengers.find((x) => x.id === p.id);
                const docs = b.documents.filter((d) => !d.issued && d.passengerId === p.id);
                const reqs = b.documentRequirements.filter((r) => r.appliesTo === "all" || r.appliesTo === p.paxType);
                return (
                  <div key={p.id ?? p.key} className="space-y-4 p-5">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-900">Passenger {i + 1}{!editable && `: ${p.fullName}`}</p>
                      {editable && pax.length > 1 && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { setPax(pax.filter((x) => x.key !== p.key)); setDirty(true); }}>Remove</Button>}
                    </div>
                    {editable ? (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Field label="Full name (as in passport)" className="sm:col-span-2"><Input value={p.fullName} onChange={(e) => updatePax(p.key, { fullName: e.target.value.toUpperCase() })} /></Field>
                        <Field label="Gender"><Select value={p.gender ?? ""} onChange={(e) => updatePax(p.key, { gender: (e.target.value || null) as PaxForm["gender"] })}><option value="">—</option><option value="male">Male</option><option value="female">Female</option></Select></Field>
                        <Field label="Date of birth"><Input type="date" value={p.dateOfBirth ?? ""} onChange={(e) => updatePax(p.key, { dateOfBirth: e.target.value || null })} /></Field>
                        <Field label="Nationality"><Input value={p.nationality ?? ""} onChange={(e) => updatePax(p.key, { nationality: e.target.value || null })} /></Field>
                        <Field label="Passport number"><Input value={p.passportNumber ?? ""} onChange={(e) => updatePax(p.key, { passportNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") || null })} /></Field>
                        <Field label="Passport issued"><Input type="date" value={p.passportIssueDate ?? ""} onChange={(e) => updatePax(p.key, { passportIssueDate: e.target.value || null })} /></Field>
                        <Field label="Passport expires"><Input type="date" value={p.passportExpiryDate ?? ""} onChange={(e) => updatePax(p.key, { passportExpiryDate: e.target.value || null })} /></Field>
                        <Field label="Passenger type"><Select value={p.paxType} onChange={(e) => updatePax(p.key, { paxType: e.target.value })}>{Object.entries(PAX_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                        {!b.isQuotation && <Field label="Room"><Select value={p.roomType ?? ""} onChange={(e) => updatePax(p.key, { roomType: e.target.value || null })}><option value="">Choose</option>{Object.entries(ROOM_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
                        <Field label="Mobile"><Input value={p.phone ?? ""} onChange={(e) => updatePax(p.key, { phone: e.target.value || null })} /></Field>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-600">{PAX_TYPES[p.paxType]}{p.roomType ? ` · ${ROOM_TYPES[p.roomType]} room` : ""} · passport {p.passportNumber ?? "—"} (expires {formatDate(p.passportExpiryDate)})</p>
                    )}
                    {saved && (reqs.length > 0 || docs.length > 0) && (
                      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                        {reqs.map((r) => {
                          const doc = [...docs].reverse().find((d) => d.requirementId === r.id);
                          return (
                            <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                              <FileText className="size-4 text-brand-600" />
                              <span className="min-w-0 flex-1">{r.name}{r.isRequired ? <span className="text-accent-500"> *</span> : <span className="text-xs text-slate-400"> (optional)</span>}</span>
                              {doc ? (
                                <>
                                  <Badge tone={DOC_REVIEW[doc.status]?.tone}>{DOC_REVIEW[doc.status]?.label}</Badge>
                                  {doc.reviewNote && <span className="text-xs text-accent-600">{doc.reviewNote}</span>}
                                  <Button size="sm" variant="ghost" onClick={() => openDoc(doc.id)}>Open</Button>
                                </>
                              ) : <Badge>Not uploaded</Badge>}
                              {can("upload") && (!doc || doc.status === "rejected" || editable) && (
                                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                                  <Upload className="size-3.5" /> {doc ? "Replace" : "Upload"}
                                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => void upload(e.target.files?.[0], saved.id, r.id)} />
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {editable && !saved && p.fullName && <p className="text-xs text-slate-500">Save to upload this passenger's documents.</p>}
                  </div>
                );
              })}
            </div>
          </Card>

          {editable && (
            <Card>
              <CardHeader title="Details" />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                {(b.availableAddons ?? []).length > 0 && (
                  <div className="space-y-2 sm:col-span-2">
                    <p className="text-sm font-medium text-slate-700">Add-ons</p>
                    {(b.availableAddons ?? []).map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-3">
                        <Checkbox label={`${a.name} · ${formatMoney(a.price, b.currency)} ${a.basis === "per_person" ? "per person" : "per booking"}`} checked={(addons[a.id] ?? 0) > 0} onChange={(e) => { setAddons({ ...addons, [a.id]: e.target.checked ? (a.basis === "per_person" ? Math.max(1, pax.length) : 1) : 0 }); setDirty(true); }} />
                        {a.basis === "per_person" && (addons[a.id] ?? 0) > 0 && (
                          <Input type="number" min={1} max={pax.length || 1} value={addons[a.id]} onChange={(e) => { setAddons({ ...addons, [a.id]: Number(e.target.value) || 1 }); setDirty(true); }} className="w-20" aria-label="People" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Field label="Your reference" hint="e.g. your customer file number"><Input value={meta.agentReference} onChange={(e) => { setMeta({ ...meta, agentReference: e.target.value }); setDirty(true); }} /></Field>
                {b.isQuotation && <Field label="Preferred travel dates" required><Input value={meta.requestedDates} onChange={(e) => { setMeta({ ...meta, requestedDates: e.target.value }); setDirty(true); }} placeholder="e.g. 10–24 March, flexible ±3 days" /></Field>}
                <Field label="Notes for our team" className="sm:col-span-2"><Textarea value={meta.agentNotes} onChange={(e) => { setMeta({ ...meta, agentNotes: e.target.value }); setDirty(true); }} className="min-h-16" placeholder={b.isQuotation ? "Hotels, room types, budget, special requests" : "Special requests"} /></Field>
              </div>
            </Card>
          )}

          {editable && (
            <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
              <Button variant="secondary" loading={busy} onClick={save}>Save</Button>
              <Button icon={Send} loading={busy} onClick={submit}>{b.status === "information_required" ? "Resubmit" : b.isQuotation ? "Send quotation request" : "Submit booking"}</Button>
              {dirty && <span className="text-sm text-amber-700">Unsaved changes</span>}
              {quote && !b.isQuotation && <span className="ml-auto text-sm text-slate-600">Total so far <b className="text-lg text-brand-700">{formatMoney(quote.total, b.currency)}</b></span>}
            </div>
          )}

          {issued.length > 0 && (
            <Card>
              <CardHeader icon={Download} title="Your travel documents" />
              <ul className="divide-y divide-slate-100">
                {issued.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <FileText className="size-4 text-brand-600" />
                    <span className="flex-1">{d.name}{d.passengerId && <span className="text-slate-400"> · {b.passengers.find((p) => p.id === d.passengerId)?.fullName}</span>}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(d.createdAt)}</span>
                    <Button size="sm" icon={Download} onClick={() => openDoc(d.id)}>Download</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <BookingDocumentsCard basePath={`/agent/documents/bookings/${b.id}`} docs={b.documentsAvailable} />
          <Card>
            <CardHeader icon={Receipt} title={b.isQuotation ? "Quotation" : "Price"} description={quote ? "Your agency's price. It is fixed when you submit." : b.isQuotation && !b.priceLines.length ? "Our team will send you a price." : undefined} />
            <div className="p-5">
              {quote ? (
                <>
                  {quote.problems.length > 0 && <Alert tone="warning" className="mb-3">{quote.problems.join(". ")}</Alert>}
                  {b.isQuotation ? <p className="text-sm text-slate-500">Indicative only: the final price comes in the quotation.</p> : <PriceTable lines={quote.lines} currency={b.currency} total={quote.total} />}
                </>
              ) : b.priceLines.length ? <PriceTable lines={b.priceLines} currency={b.currency} total={b.totalAmount} /> : <p className="text-sm text-slate-500">—</p>}
            </div>
          </Card>
          {b.stages.length > 0 && b.status !== "draft" && (
            <Card>
              <CardHeader icon={ListChecks} title="Progress" />
              <ol className="space-y-2 p-5">
                {b.stages.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    {s.done ? <CheckCircle2 className="size-4 text-brand-600" /> : <span className="size-4 rounded-full border-2 border-slate-300" />}
                    <span className={cx(s.done ? "text-slate-800" : "text-slate-500")}>{s.name}</span>
                    {s.done && <span className="ml-auto text-xs text-slate-400">{formatDate(s.completedAt)}</span>}
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {b.status !== "draft" && <MessagesCard messages={b.messages} staff={false} canSend={can("message")} onSend={(message) => run(() => api.post(`/agent/bookings/${b.id}/messages`, { message }))} />}
          <HistoryCard history={b.history} />
        </div>
      </div>

      <Modal open={cancelling} onClose={() => setCancelling(false)} title={b.status === "draft" ? "Discard this draft?" : "Cancel this booking?"}
        footer={<><Button variant="secondary" onClick={() => setCancelling(false)}>Keep it</Button><Button variant="danger" loading={busy} onClick={async () => { if (await run(() => api.post(`/agent/bookings/${b.id}/cancel`, { reason: cancelReason || null }))) setCancelling(false); }}>{b.status === "draft" ? "Discard" : "Cancel booking"}</Button></>}>
        {b.status !== "draft" && <Field label="Reason (optional)"><Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus /></Field>}
        {b.seatsHeld > 0 && <p className="mt-2 text-sm text-slate-500">The {b.seatsHeld} held seat{b.seatsHeld === 1 ? "" : "s"} will be released.</p>}
      </Modal>
    </div>
  );
}
