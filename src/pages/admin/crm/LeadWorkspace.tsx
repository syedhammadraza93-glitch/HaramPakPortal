import { useEffect, useState, useRef, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMe } from "../../../redux/hooks";
import { api, fieldErrors } from "../../../utils/api";

import { InitialNotes, NoteDetails } from "./InitialNotes";

import FlightSearch, { type FlightQuote } from "./FlightSearch";

const root = "/admin/crm";
const stages = ["new", "contacted", "qualified", "quoted", "follow_up", "booked", "lost"];
const sources = ["phone", "whatsapp", "office_visit", "agency_referral", "social", "other"];
const pretty = (value: string) => value.replace(/_/g, " ").replace(/^./, initial => initial.toUpperCase());
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const message = (err: unknown) => err instanceof Error ? err.message : "The request failed.";
const input = "w-full min-w-0 rounded-md border bg-white p-2 text-sm aria-invalid:border-red-600";
const button = "rounded-md border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50";
const primary = "rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const panel = "space-y-3 rounded-lg border bg-white p-4";

type Lead = {
  id: string; reference: string; name: string; phone: string; email: string | null; service: string;
  source: string; city: string | null; campaign: string | null; stage: string; version: number;
  ownerId: string | null; ownerName?: string | null; firstResponseDueAt: string; firstContactAt: string | null;
  nextFollowUpAt: string | null; escalatedAt: string | null; bookingReference: string | null; lossReason: string | null;
  packageSlug: string | null; travelDate: string | null; travellers: number | null;
};
type QuoteLine = { label: string; quantity: number; unitMinor: number };
type Quote = { id: string; revision: number; currency: string; validUntil: string; lines: QuoteLine[]; sentAt: string | null };
type LeadDetails = { lead: Lead; events: { id: string; kind: string; details: string; createdAt: string; actor: string | null }[]; quotes: Quote[] };
type Owners = { id: string; name: string }[];
type Metrics = {
  stages: { key: string; count: number }[];
  sources: { key: string; stage: string; count: number }[];
  campaigns: { key: string | null; stage: string; count: number }[];
  timing: { averageResponseMinutes: number | null; escalated: number };
  owners: { key: string | null; ownerId: string | null; stage: string; count: number }[];
};

function Field({ label, children, error, errorId }: { label: string; children: ReactNode; error?: string; errorId?: string }) {
  return <label className="grid min-w-0 gap-1 text-sm font-medium">{label}{children}
    {error && <span id={errorId} className="text-xs text-red-700">{error}</span>}
  </label>;
}
function Options({ items }: { items: string[] }) {
  return <>{items.map(item => <option key={item} value={item}>{pretty(item)}</option>)}</>;
}
function Notice({ notice }: { notice?: { text: string; error?: boolean } }) {
  return notice ? <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-sm text-red-700" : "text-sm text-brand-800"}>{notice.text}</p> : null;
}
function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return (name: string) => String(data.get(name) ?? "").trim();
}
function localDate(value: string | null) {
  if (!value) return "";
  const now = new Date(value);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function LeadMetrics() {
  const [metrics, setMetrics] = useState<Metrics>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.get<Metrics>(root + "/metrics").then(data => { if (active) setMetrics(data); })
      .catch(err => { if (active) setError(message(err)); });
    return () => { active = false; };
  }, []);
  if (!metrics) return error ? <Notice notice={{ error: true, text: error }} /> : <p role="status">Loading pipeline metrics…</p>;
  return <div className="grid gap-4 md:grid-cols-3">
    <section className={panel}><h3 className="font-semibold">Response times</h3><p className="text-sm">Average first response · {metrics.timing.averageResponseMinutes == null ? "—" : Math.round(metrics.timing.averageResponseMinutes) + " min"}</p><p className="text-sm">Currently escalated · {metrics.timing.escalated}</p></section>
    {[
      { heading: "Pipeline stages", rows: metrics.stages.map(row => [pretty(row.key), row.count]) },
      { heading: "Outcomes by source", rows: metrics.sources.map(row => [pretty(row.key) + " · " + pretty(row.stage), row.count]) },
      { heading: "Campaign outcomes", rows: metrics.campaigns.map(row => [(row.key ?? "Unknown") + " · " + pretty(row.stage), row.count]) },
      { heading: "Outcomes by owner", rows: metrics.owners.map(row => [(row.key ?? "Unassigned") + " · " + pretty(row.stage), row.count]) },
    ].map(({ heading, rows }) =>
      <section key={heading} className={panel}><h3 className="font-semibold">{heading}</h3>
        <dl className="space-y-1 text-sm">{rows.map(([label, count], index) =>
          <div key={index} className="flex justify-between gap-2"><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
        {!rows.length && <p className="text-sm text-slate-600">No leads yet.</p>}
      </section>)}
  </div>;
}

function EscalationSettings({ refresh }: { refresh: () => void }) {
  const [rules, setRules] = useState<{ firstResponseMinutes: number; followUpMinutes: number }>();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api.get<NonNullable<typeof rules>>(root + "/rules").then(data => { if (active) setRules(data); })
      .catch(error => { if (active) setNotice({ text: message(error), error: true }); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    const get = values(event);
    setBusy(true);
    try {
      const data = { firstResponseMinutes: Number(get("first")), followUpMinutes: Number(get("follow")) };
      await api.put(root + "/rules", data);
      setRules(data);
      setNotice({ text: "Escalation rules saved for future deadlines." });
    } catch (error) { setNotice({ text: message(error), error: true }); }
    finally { setBusy(false); }
  }
  async function sweep() {
    setBusy(true);
    try {
      const result = await api.post<{ escalated: number }>(root + "/sweep");
      setNotice({ text: result.data.escalated + " leads escalated." });
      refresh();
    } catch (error) { setNotice({ text: message(error), error: true }); }
    finally { setBusy(false); }
  }
  return <section className={panel}><h2 className="font-semibold">Escalation rules</h2>
    <p className="text-sm text-slate-600">Missed deadlines appear in the escalation queue. Deadlines use elapsed minutes.</p>
    {rules && <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
      <Field label="First response deadline (minutes)"><input className={input} name="first" type="number" min="1" max="10080" required defaultValue={rules.firstResponseMinutes} /></Field>
      <Field label="Default follow-up interval (minutes)"><input className={input} name="follow" type="number" min="1" max="43200" required defaultValue={rules.followUpMinutes} /></Field>
      <div className="flex gap-2"><button className={primary} disabled={busy}>Save rules</button><button type="button" className={button} disabled={busy} onClick={() => void sweep()}>Check overdue leads now</button></div>
    </form>}
    <Notice notice={notice} />
  </section>;
}

export function LeadWorkspace() {
  const manager = !!useMe()?.permissions.includes("crm.manage");
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [escalated, setEscalated] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: Lead[]; total: number }>();
  const [view, setView] = useState<"list" | "metrics" | "rules">("list");
  const [revision, setRevision] = useState(0);
  const [enquiryErrors, setEnquiryErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const refresh = () => setRevision(value => value + 1);

  useEffect(() => {
    let current = true;
    void api.get<{ items: Lead[]; total: number }>(root + "/leads", { stage, search, page, escalated: escalated ? "true" : undefined })
      .then(data => { if (current) setResult(data); })
      .catch(error => { if (current) setNotice({ text: message(error), error: true }); });
    return () => { current = false; };
  }, [stage, search, page, escalated, revision]);

  function showEnquiryErrors(form: HTMLFormElement, errors: Record<string, string>) {
    setEnquiryErrors(errors);
    setNotice({ text: "Please correct the highlighted fields.", error: true });
    requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }

  function enquiryField(name: string) {
    return { name, "aria-invalid": !!enquiryErrors[name], "aria-describedby": enquiryErrors[name] ? "enquiry-error-" + name : undefined };
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const get = values(event);
    const phone = get("phone");
    const note = get("note");
    const phoneError = "Enter a valid phone number with 7 to 15 digits, such as +92 300 1234567.";
    const errors: Record<string, string> = {};
    if (!/^\+?[0-9() .-]+$/.test(phone) || !/^\+?\d{7,15}$/.test(phone.replace(/[^\d+]/g, ""))) errors.phone = phoneError;
    if (note.length > 1500) errors.note = "Shorten the initial notes to 1,500 characters including formatting.";
    if (Object.keys(errors).length) return showEnquiryErrors(form, errors);

    setEnquiryErrors({});
    setNotice(undefined);
    setBusy(true);
    try {
      const response = await api.post<{ id: string; reference: string }>(root + "/leads", {
        name: get("name"), phone, email: get("email"), source: get("source"),
        service: get("service"), city: get("city"), note,
      });
      setAdding(false);
      setNotice({ text: "Enquiry " + response.data.reference + " created and assigned to you." });
      refresh();
    } catch (error) {
      const fields = fieldErrors(error);
      const visible = Object.fromEntries(Object.entries(fields).filter(([name]) =>
        ["name", "phone", "email", "source", "service", "city", "note"].includes(name)));
      if (visible.phone) visible.phone = phoneError;
      if (Object.keys(visible).length) showEnquiryErrors(form, visible);
      else setNotice({ text: Object.values(fields)[0] ?? message(error), error: true });
    } finally { setBusy(false); }
  }

  return <main className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <header><h1 className="text-2xl font-bold">Leads</h1><p className="text-sm text-slate-600">{manager ? "Manage enquiries, assignments and follow-up across the sales team." : "Work your assigned enquiries and record customer activity."}</p></header>
      <button type="button" className={primary} onClick={() => { setEnquiryErrors({}); setNotice(undefined); setAdding(value => !value); }}>{adding ? "Close form" : "Add enquiry"}</button>
    </div>
    <div className="flex flex-wrap gap-2">{(["list", "metrics", ...(manager ? ["rules"] : [])] as ("list" | "metrics" | "rules")[]).map(item =>
      <button type="button" className={button} key={item} aria-pressed={view === item} onClick={() => setView(item)}>{({ list: "Lead queue", metrics: "Pipeline metrics", rules: "Escalation rules" })[item]}</button>)}</div>
    <Notice notice={notice} />
    {adding && <form className={panel} onSubmit={create}>
      <h2 className="font-semibold">Manual enquiry</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name" error={enquiryErrors.name} errorId="enquiry-error-name"><input className={input} {...enquiryField("name")} required minLength={2} maxLength={120} /></Field>
        <Field label="Phone" error={enquiryErrors.phone} errorId="enquiry-error-phone"><input className={input} {...enquiryField("phone")} required type="tel" maxLength={40} /></Field>
        <Field label="Email" error={enquiryErrors.email} errorId="enquiry-error-email"><input className={input} {...enquiryField("email")} type="email" maxLength={180} /></Field>
        <Field label="Source" error={enquiryErrors.source} errorId="enquiry-error-source"><select className={input} {...enquiryField("source")}><Options items={sources} /></select></Field>
        <Field label="Service" error={enquiryErrors.service} errorId="enquiry-error-service"><input className={input} {...enquiryField("service")} required minLength={2} maxLength={120} /></Field>
        <Field label="City" error={enquiryErrors.city} errorId="enquiry-error-city"><input className={input} {...enquiryField("city")} maxLength={100} /></Field>
      </div>
      <InitialNotes error={enquiryErrors.note} />
      <button className={primary} disabled={busy}>Create enquiry</button>
    </form>}
    {view === "metrics" && <LeadMetrics />}
    {view === "rules" && manager && <EscalationSettings refresh={refresh} />}
    {view === "list" && <>
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <Field label="Search by name, phone or service"><input className={input} maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></Field>
        <Field label="Stage"><select className={input} value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}><option value="">All stages</option><Options items={stages} /></select></Field>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={escalated} onChange={e => { setEscalated(e.target.checked); setPage(1); }} />Escalated only</label>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-[720px] w-full text-left text-sm">
          <thead className="bg-slate-50"><tr>{["Enquiry", "Service", "Source", "Stage", "Owner", "Deadline"].map(col => <th className="p-3" key={col} scope="col">{col}</th>)}</tr></thead>
          <tbody>{result?.items.map(lead =>
            <tr className="border-t" key={lead.id}><td className="p-3"><Link className="font-semibold text-brand-800 underline" to={root + "/leads/" + lead.id}>{lead.name}</Link><p className="text-xs text-slate-600">{lead.phone}</p></td>
              <td className="p-3">{lead.service}</td><td className="p-3">{pretty(lead.source)}</td><td className="p-3">{pretty(lead.stage)}{lead.escalatedAt && <p className="font-semibold text-red-700">Escalated</p>}</td>
              <td className="p-3">{lead.ownerName ?? "Unassigned"}</td><td className="p-3">{date(lead.nextFollowUpAt ?? (!lead.firstContactAt && !["booked", "lost"].includes(lead.stage) ? lead.firstResponseDueAt : null))}</td>
            </tr>)}</tbody>
        </table>
        {!result?.items.length && <p className="p-4 text-sm" role="status">{result ? "No leads match your filters." : "Loading enquiries…"}</p>}
      </div>
      {result && <div className="flex items-center gap-3 text-sm"><button className={button} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {result.total} leads</span><button className={button} disabled={page * 50 >= result.total} onClick={() => setPage(page + 1)}>Next</button></div>}
    </>}
  </main>;
}

export function LeadDetail() {
  const id = useParams().id;
  const path = root + "/leads/" + id;
  const manager = !!useMe()?.permissions.includes("crm.manage");
  const [details, setDetails] = useState<LeadDetails>();
  const [owners, setOwners] = useState<Owners>([]);
  const [stage, setStage] = useState("new");
  const [editingContact, setEditingContact] = useState(false);
  const [lines, setLines] = useState<{ key: number; fare?: FlightQuote }[]>([{ key: 0 }]);
  const quoteForm = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  useEffect(() => {
    let active = true;
    setDetails(undefined);
    setNotice(undefined);
    void api.get<LeadDetails>(path).then(data => { if (active) { setDetails(data); setStage(data.lead.stage); } })
      .catch(error => { if (active) setNotice({ text: message(error), error: true }); });
    if (manager) void api.get<Owners>(root + "/owners").then(data => { if (active) setOwners(data); })
      .catch(error => { if (active) setNotice({ text: message(error), error: true }); });
    return () => { active = false; };
  }, [path, manager]);

  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await operation();
      const data = await api.get<LeadDetails>(path);
      setDetails(data);
      setStage(data.lead.stage);
      setNotice({ text: success });
      return true;
    } catch (error) { setNotice({ text: message(error), error: true }); return false; }
    finally { setBusy(false); }
  }
  if (!details) return <div className="space-y-2"><Link to={root} className="underline">Back to leads</Link><Notice notice={notice} />{!notice && <p role="status">Loading lead…</p>}</div>;
  const { lead, events, quotes } = details;
  const closed = ["booked", "lost"].includes(lead.stage);

  function update(event: FormEvent<HTMLFormElement>) {
    const get = values(event);
    const next = get("next");
    void run(() => api.patch(path, {
      stage, version: lead.version, bookingReference: get("booking"), lossReason: get("loss"),
      nextFollowUpAt: next ? new Date(next).toISOString() : undefined,
      ...(get("clear") ? { nextFollowUpAt: null } : {}),
      ...(manager ? { ownerId: get("owner") || null } : {}),
    }), "Lead updated.");
  }
  async function editContact(event: FormEvent<HTMLFormElement>) {
    const get = values(event);
    const contact = { name: get("name"), phone: get("phone"), email: get("email"), city: get("city"),
      service: get("service"), travelDate: get("travelDate"), travellers: get("travellers") ? Number(get("travellers")) : undefined };
    if (await run(() => api.patch(path, { version: lead.version, contact }), "Contact details updated.")) setEditingContact(false);
  }
  async function activity(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const get = values(event);
    if (await run(() => api.post(path + "/events", { kind: get("kind"), details: get("details"), reachedCustomer: !!get("reached") }), "Activity recorded.")) form.reset();
  }
  function addFlight(fare: FlightQuote) {
    const form = quoteForm.current;
    if (!form || !fare.label || !Number.isFinite(fare.total) || fare.total <= 0 || fare.total > 10000000 || lines.length >= 30) {
      setNotice({ text: "Check the fare details and available quote lines.", error: true });
      return false;
    }
    const data = new FormData(form);
    const currency = form.elements.namedItem("currency");
    if (currency instanceof HTMLSelectElement && currency.value !== fare.currency) {
      if (lines.some(({ key }) => data.get("item-" + key) || data.get("price-" + key))) {
        setNotice({ text: "The fare currency must match the existing quote lines.", error: true });
        return false;
      }
      currency.value = fare.currency;
    }
    setLines(prev => [...prev.filter(({ key }) => data.get("item-" + key) || data.get("price-" + key)),
      { key: Math.max(...prev.map(row => row.key)) + 1, fare }]);
    setNotice(undefined);
    return true;
  }

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const get = values(event);
    const items = lines.map(({ key }) => ({
      label: get("item-" + key), quantity: Number(get("quantity-" + key)),
      unitMinor: Math.round(Number(get("price-" + key)) * 100),
    }));
    if (await run(() => api.post(path + "/quotes", { currency: get("currency"), validUntil: get("valid"), lines: items, terms: get("terms") }), "Quote revision created.")) {
      form.reset();
      setLines([{ key: 0 }]);
    }
  }
  async function download(quote: Quote) {
    try { await api.downloadFile(path + "/quotes/" + quote.id + "/pdf"); }
    catch (error) { setNotice({ text: message(error), error: true }); }
  }

  return <main className="space-y-5">
    <Link to={root} className="text-sm font-semibold underline">Back to leads</Link>
    <header><h1 className="text-2xl font-bold">{lead.name}</h1>
      <p className="break-all text-sm text-slate-600">{lead.reference}</p>
      {lead.escalatedAt && <p className="font-semibold text-red-700">Escalated · {date(lead.escalatedAt)}</p>}
    </header>
    <Notice notice={notice} />
    <div className="grid gap-4 xl:grid-cols-2">
      <section className={panel}><h2 className="font-semibold">Enquiry details</h2><dl className="grid grid-cols-2 gap-2 text-sm">
        {[
          ["Phone", lead.phone], ["Email", lead.email], ["Service", lead.service], ["Source", pretty(lead.source)], ["Campaign", lead.campaign],
          ["Package", lead.packageSlug], ["City", lead.city], ["Travel dates", lead.travelDate], ["Travellers", lead.travellers],
          ["First-response deadline", date(lead.firstResponseDueAt)], ["First contacted", date(lead.firstContactAt)], ["Next follow-up", date(lead.nextFollowUpAt)],
        ].map(([key, value]) => <div className="min-w-0" key={key}><dt className="font-medium">{key}</dt><dd className="break-words">{value || "—"}</dd></div>)}
      </dl>
      <button type="button" className={button} onClick={() => setEditingContact(value => !value)}>{editingContact ? "Close contact editor" : "Edit contact details"}</button>
      {editingContact && <form className="grid gap-3 sm:grid-cols-2" onSubmit={editContact}>
        <Field label="Name"><input className={input} name="name" required minLength={2} maxLength={120} defaultValue={lead.name} /></Field>
        <Field label="Phone"><input className={input} name="phone" type="tel" required maxLength={40} defaultValue={lead.phone} /></Field>
        <Field label="Email"><input className={input} name="email" type="email" maxLength={180} defaultValue={lead.email ?? ""} /></Field>
        <Field label="City"><input className={input} name="city" maxLength={100} defaultValue={lead.city ?? ""} /></Field>
        <Field label="Service"><input className={input} name="service" required minLength={2} maxLength={120} defaultValue={lead.service} /></Field>
        <Field label="Travel date"><input className={input} name="travelDate" maxLength={80} defaultValue={lead.travelDate ?? ""} /></Field>
        <Field label="Travellers"><input className={input} name="travellers" type="number" min="1" max="200" defaultValue={lead.travellers ?? ""} /></Field>
        <button className={primary} disabled={busy}>Save contact details</button>
      </form>}
      </section>
      <form className={panel} key={lead.version} onSubmit={update}>
        <h2 className="font-semibold">Stage and assignment</h2>
        <Field label="Stage"><select className={input} value={stage} disabled={closed && !manager} onChange={e => setStage(e.target.value)}><Options items={stages} /></select></Field>
        {manager && <Field label="Owner"><select className={input} name="owner" defaultValue={lead.ownerId ?? ""}><option value="">Unassigned</option>{owners.map(owner => <option value={owner.id} key={owner.id}>{owner.name}</option>)}</select></Field>}
        {stage === "booked" && <Field label="Confirmed booking reference"><input className={input} name="booking" required maxLength={80} defaultValue={lead.bookingReference ?? ""} /></Field>}
        {stage === "lost" && <Field label="Loss reason"><input className={input} name="loss" required maxLength={300} defaultValue={lead.lossReason ?? ""} /></Field>}
        {!["booked", "lost"].includes(stage) && <>
          <Field label="Next follow-up (local time)"><input className={input} type="datetime-local" name="next" defaultValue={localDate(lead.nextFollowUpAt)} /></Field>
          <label className="flex gap-2 text-sm"><input type="checkbox" name="clear" />Clear follow-up</label>
        </>}
        <button className={primary} disabled={busy}>Save lead</button>
      </form>
      <section className={panel}><h2 className="font-semibold">Activity timeline</h2>
        <form className="space-y-2" onSubmit={activity}>
          <Field label="Activity type"><select className={input} name="kind"><Options items={["call", "whatsapp", "office_visit", "email", "note"]} /></select></Field>
          <Field label="Details"><textarea className={input} name="details" required maxLength={1500} /></Field>
          {!closed && <label className="flex gap-2 text-sm"><input type="checkbox" name="reached" />Reached the customer</label>}
          <button className={primary} disabled={busy}>Record activity</button>
        </form>
        <ol className="max-h-96 space-y-2 overflow-auto">{events.map(event => <li key={event.id} className="border-t pt-2 text-sm"><strong>{pretty(event.kind)}</strong> · {date(event.createdAt)} · {event.actor ?? "System"}<NoteDetails value={event.details} /></li>)}</ol>
      </section>
      {!closed && <FlightSearch key={path} path={path} departure={lead.travelDate} adults={lead.travellers} onAdd={addFlight} />}
      <section className={panel}><h2 className="font-semibold">Quotes</h2>
        <ul className="space-y-2">{quotes.map(quote => <li className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm" key={quote.id}>
          <span>Revision {quote.revision} · {quote.currency} · Valid through {quote.validUntil} · {quote.sentAt ? "Sent " + date(quote.sentAt) : "Ready to send"}</span>
          <div className="flex gap-2"><button className={button} onClick={() => void download(quote)}>Download PDF</button>
            {!closed && !quote.sentAt && <button className={button} disabled={busy} onClick={() => void run(() => api.post(path + "/quotes/" + quote.id + "/sent"), "Quote marked sent.")}>Mark sent</button>}</div>
        </li>)}</ul>
        {!closed && <form className="space-y-3" ref={quoteForm} onSubmit={createQuote}>
          <div className="grid grid-cols-2 gap-2"><Field label="Currency"><select className={input} name="currency">{["PKR", "SAR", "USD", "CAD", "GBP", "EUR"].map(code => <option key={code}>{code}</option>)}</select></Field>
            <Field label="Valid through"><input className={input} type="date" name="valid" min={new Date().toISOString().slice(0, 10)} required /></Field></div>
          {lines.map(({ key, fare }, index) => <div key={key} className="grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <Field label={"Item " + (index + 1)}><input className={input} name={"item-" + key} defaultValue={fare?.label} required maxLength={180} /></Field>
            <Field label="Quantity"><input className={input} type="number" min="1" max="1000" name={"quantity-" + key} defaultValue="1" required /></Field>
            <Field label="Unit price"><input className={input} type="number" min="0" max="10000000" step="0.01" name={"price-" + key} defaultValue={fare?.total} required /></Field>
            {lines.length > 1 && <button type="button" className={button} onClick={() => setLines(prev => prev.filter(row => row.key !== key))}>Remove item {index + 1}</button>}
          </div>)}
          <button type="button" className={button} disabled={lines.length >= 30} onClick={() => setLines(prev => [...prev, { key: Math.max(...prev.map(row => row.key)) + 1 }])}>Add line item</button>
          <Field label="Terms and inclusions"><textarea className={input} name="terms" maxLength={2000} /></Field>
          <button className={primary} disabled={busy}>Create quote revision</button>
        </form>}
      </section>
    </div>
  </main>;
}
